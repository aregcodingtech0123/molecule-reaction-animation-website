// A developer's shell may export SITE_OWNER_* (or a tool may have loaded them): the suites must see the empty (draft) state
// unless a test sets the variables itself.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("SITE_OWNER_")) delete process.env[name];
}
