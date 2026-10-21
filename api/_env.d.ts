// Vercel functions run on Node, but the project has no @types/node.
// Only the bit the Google sign-in function reads is declared here.
declare var process: { env: Record<string, string | undefined> };
