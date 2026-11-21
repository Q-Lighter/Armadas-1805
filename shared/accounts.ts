// Account rules shared by the client, the Worker and the tests.
//
// Accounts are username and password only. Supabase Auth still wants an email,
// so one function maps a username to a made-up address. Keeping that mapping
// here means real email can be added later without changing the forms.

import { settings } from "./settings.js";

const USERNAME_PATTERN = new RegExp(
  `^[A-Za-z0-9_]{${settings.accounts.usernameMin},${settings.accounts.usernameMax}}$`,
);

export interface AccountIdentity {
  username: string;
  email: string;
  displayName: string;
}

/** Usernames are unique without regard to case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameError(raw: string): string | null {
  const username = raw.trim();
  if (!username) return "Enter a username.";
  if (username.length < settings.accounts.usernameMin ||
      username.length > settings.accounts.usernameMax) {
    return `Username must be ${settings.accounts.usernameMin} to ${settings.accounts.usernameMax} characters.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Username can use letters, digits and underscore only.";
  }
  return null;
}

export function passwordError(raw: string): string | null {
  if (raw.length < settings.accounts.passwordMin) {
    return `Password must be at least ${settings.accounts.passwordMin} characters.`;
  }
  return null;
}

export function displayNameError(raw: string): string | null {
  const name = raw.trim();
  if (name.length < settings.accounts.displayNameMin ||
      name.length > settings.accounts.displayNameMax) {
    return `Display name must be ${settings.accounts.displayNameMin} to ${settings.accounts.displayNameMax} characters.`;
  }
  // Printable text only: no control characters, and no angle brackets that
  // could be mistaken for page markup.
  if (/[\u0000-\u001f\u007f<>]/.test(name)) {
    return "Display name cannot contain control characters or angle brackets.";
  }
  return null;
}

/** One mapping for sign-up, login and password changes. */
export function accountEmailFor(
  rawUsername: string,
  domain: string = settings.accounts.emailDomain,
): string {
  return `${normalizeUsername(rawUsername)}@${domain}`;
}

/** Validate the three form values and return the account identity to create. */
export function accountIdentityFor(input: {
  username: string;
  password: string;
  displayName?: string;
}): { identity?: AccountIdentity; error?: string } {
  const error = usernameError(input.username) ??
    passwordError(input.password) ??
    displayNameError(input.displayName?.trim() || input.username.trim());
  if (error) return { error };
  const username = input.username.trim();
  return {
    identity: {
      username,
      email: accountEmailFor(username),
      displayName: (input.displayName?.trim() || username),
    },
  };
}
