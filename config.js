// Wanderly runtime config.
// - pendoApiKey: optional. If set, js/analytics.js loads the Pendo agent and identifies the visitor.
//   (Leave empty if you paste the Novus snippet straight into index.html.)
// - fixes: product-quality toggles. All OFF = the "as shipped" experience with lots of friction.
//   Flip these to true (e.g. after Novus recommends them) and watch the funnel improve.
window.WANDERLY_CONFIG = {
  pendoApiKey: "",
  fixes: {
    keepFiltersOnSort: false,   // sorting no longer resets price/stops filters
    showFeesEarly: false,       // show taxes + concierge fee on the trip page, not first at payment
    inlineValidation: false,    // traveler form validates inline with format hints
    guestCheckout: false,       // no forced sign-in before checkout
    payButtonFeedback: false,   // spinner + disabled state while payment processes
    mobileCtaFix: false,        // sticky mobile bar no longer covers the "Continue" button
    priceBreakdownClickable: false, // the "Price breakdown" link actually opens a breakdown
    assistantBookWorks: false,  // "Book this" in AI chat always works
    assistantFaster: false      // AI replies in ~1s and understand more prompts
  }
};
