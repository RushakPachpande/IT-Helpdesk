export const PASSWORD_MIN_LENGTH = 10

/** Returns a list of unmet rules; empty means the password is acceptable. */
export function passwordProblems(pw: string): string[] {
  const problems: string[] = []
  if (pw.length < PASSWORD_MIN_LENGTH) problems.push(`At least ${PASSWORD_MIN_LENGTH} characters`)
  if (!/[a-z]/.test(pw)) problems.push('A lowercase letter')
  if (!/[A-Z]/.test(pw)) problems.push('An uppercase letter')
  if (!/\d/.test(pw)) problems.push('A digit')
  return problems
}
