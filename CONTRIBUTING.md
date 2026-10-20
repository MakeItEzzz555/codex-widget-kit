# Contributing

Thanks for helping. A few rules keep the kit small and trustworthy:

1. **Zero dependencies.** Node's standard library only.
2. **Read-only and private.** New widgets read rollout fields that are already recorded, never prompts or outputs. List every new field in [CAPABILITY.md](CAPABILITY.md).
3. **No guessing.** If the data isn't there, hide the widget.
4. **Tests.** `npm test` must pass. Add a redacted fixture line for any new record type under `test/fixtures/`. Keep only the fields you read.

Ideas waiting for an owner are in [IDEAS.md](IDEAS.md). Open an issue before a large change.
