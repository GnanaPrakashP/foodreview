// Starts/ends with letter or digit.
// Middle: letters, digits, underscore, dot — no consecutive specials (.. __ ._ _.)
// Length: 3–20. Lowercase only.
export const USERNAME_REGEX = /^(?!.*[._]{2})[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}
