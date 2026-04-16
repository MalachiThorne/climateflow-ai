const Stripe = require("stripe");
const config = require("./config");
const store = require("./store");

const stripe = new Stripe(config.stripe.secretKey);

// Builds a priceId → plan lookup from config.stripe.plans for webhook mapping.
function findPlanByPriceId(priceId) {
  if (!priceId) return null;
  for (const plan of Object.values(config.stripe.plans)) {
    if (plan.priceId && plan.priceId === priceId) return plan;
  }
  return null;
}

// Creates a Stripe customer, attaches their card, and starts a 7-day trial subscription.
// Returns { customerId, subscriptionId, status } — store these on the client record.
async function createSubscription(businessId, businessName, ownerEmail, paymentMethodId, priceId) {
  const resolvedPriceId = priceId || config.stripe.plans.bundle.priceId;
  if (!resolvedPriceId) {
    throw new Error("No Stripe price ID configured for the selected plan");
  }

  const customer = await stripe.customers.create({
    name: businessName,
    email: ownerEmail,
    payment_method: paymentMethodId,
    invoice_settings: { default_payment_method: paymentMethodId },
    metadata: { businessId },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: resolvedPriceId }],
    trial_period_days: 7,
    payment_settings: {
      payment_method_types: ["card"],
      save_default_payment_method: "on_subscription",
    },
    metadata: { businessId },
  });

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    status: subscription.status, // "trialing"
    trialEnd: new Date(subscription.trial_end * 1000).toISOString(),
  };
}

// Cancels a subscription immediately (used on explicit client request or extreme delinquency)
async function cancelSubscription(subscriptionId) {
  return stripe.subscriptions.cancel(subscriptionId);
}

// Creates a Stripe Billing Portal session so a client can manage their payment method / cancel
async function createBillingPortalSession(stripeCustomerId, returnUrl) {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

// Validates and parses an incoming Stripe webhook event
function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    config.stripe.webhookSecret
  );
}

// Handles Stripe webhook events — updates client subscription state in the DB
async function handleWebhookEvent(event) {
  const { type, data } = event;

  switch (type) {
    case "invoice.payment_failed": {
      const invoice = data.object;
      const businessId = invoice.metadata?.businessId ||
        (await getBusinessIdByCustomer(invoice.customer));
      if (!businessId) break;
      console.log(`[Billing] Payment failed for business ${businessId}`);
      await store.updateRecord("clients", businessId, {
        paymentStatus: "past_due",
        suspended: false, // give grace period — Stripe retries for 7 days by default
      });
      break;
    }

    case "customer.subscription.deleted": {
      const sub = data.object;
      const businessId = sub.metadata?.businessId ||
        (await getBusinessIdByCustomer(sub.customer));
      if (!businessId) break;
      console.log(`[Billing] Subscription cancelled for business ${businessId} — suspending`);
      await store.updateRecord("clients", businessId, {
        suspended: true,
        suspendedAt: new Date().toISOString(),
        suspendReason: "subscription_cancelled",
      });
      break;
    }

    case "customer.subscription.updated": {
      // Fires on plan changes made via the Stripe Billing Portal (upgrade/downgrade),
      // as well as harmless updates (trial advance, metadata, payment method swap).
      // We recompute plan + features from the subscription's current items.
      const sub = data.object;
      const businessId = sub.metadata?.businessId ||
        (await getBusinessIdByCustomer(sub.customer));
      if (!businessId) break;

      const items = sub.items?.data || [];
      const matchedPlans = items
        .map((item) => findPlanByPriceId(item.price?.id))
        .filter(Boolean);

      if (matchedPlans.length === 0) {
        console.warn(
          `[Billing] subscription.updated for ${businessId}: no matching plan for priceIds ${items.map((i) => i.price?.id).join(", ")} — plan features unchanged`
        );
        break;
      }

      // Prefer a single bundle match; otherwise union features across matched plans.
      const bundle = matchedPlans.find((p) => p.id === "bundle");
      const chosen = bundle || matchedPlans[0];
      const features = bundle
        ? bundle.features
        : [...new Set(matchedPlans.flatMap((p) => p.features))];

      await store.updateRecord("clients", businessId, {
        plan: chosen.id,
        planFeatures: features,
        stripeSubscriptionId: sub.id,
        billingStatus: sub.status,
      });
      console.log(
        `[Billing] Plan updated for ${businessId}: ${chosen.id} (${features.join(", ")})`
      );
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = data.object;
      // Skip trial invoices (amount = 0)
      if (invoice.amount_paid === 0) break;
      const businessId = invoice.metadata?.businessId ||
        (await getBusinessIdByCustomer(invoice.customer));
      if (!businessId) break;
      console.log(`[Billing] Payment succeeded for business ${businessId}`);
      await store.updateRecord("clients", businessId, {
        paymentStatus: "active",
        suspended: false,
        lastPaymentAt: new Date().toISOString(),
      });
      break;
    }

    case "customer.subscription.trial_will_end": {
      // Fires 3 days before trial ends — used to trigger reminder email
      const sub = data.object;
      const businessId = sub.metadata?.businessId ||
        (await getBusinessIdByCustomer(sub.customer));
      if (!businessId) break;
      console.log(`[Billing] Trial ending soon for business ${businessId}`);
      // The email module picks this up
      await store.updateRecord("clients", businessId, {
        trialEndingSoon: true,
        trialEnd: new Date(sub.trial_end * 1000).toISOString(),
      });
      break;
    }

    default:
      // Unhandled event type — not an error
      break;
  }
}

// Looks up a businessId by Stripe customerId (fallback when metadata isn't on the event)
async function getBusinessIdByCustomer(stripeCustomerId) {
  const client = await store.findRecordByField("clients", "stripeCustomerId", stripeCustomerId);
  return client?.id || null;
}

module.exports = {
  createSubscription,
  cancelSubscription,
  createBillingPortalSession,
  constructWebhookEvent,
  handleWebhookEvent,
};
