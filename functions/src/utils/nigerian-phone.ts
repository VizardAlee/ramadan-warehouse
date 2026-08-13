const localMobile = /^0[789]\d{9}$/;
const internationalMobile = /^\+234[789]\d{9}$/;

export function isSupportedNigerianMobile(value: string): boolean {
  return localMobile.test(value) || internationalMobile.test(value);
}

export function toFirebasePhoneNumber(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return localMobile.test(value) ? `+234${value.slice(1)}` : value;
}
