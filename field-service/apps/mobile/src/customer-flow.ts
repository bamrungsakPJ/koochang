import type { Customer } from './api';

/** Both a new customer and a duplicate-phone selection continue the original intent. */
export function customerDestination(intent: 'jobNew' | 'serviceAdhoc' | undefined, customer: Customer) {
  const only = customer.locations.length === 1 ? customer.locations[0]! : null;
  if (intent === 'jobNew' && only) return { screen: 'jobNew' as const, customerId: customer.id, locationId: only.id };
  if (intent === 'serviceAdhoc' && only) return { screen: 'serviceAdhoc' as const, customerId: customer.id, locationId: only.id };
  if (intent && customer.locations.length > 1) return { screen: 'customerLocationPick' as const, customer, then: intent };
  return { screen: 'customer' as const, id: customer.id };
}
