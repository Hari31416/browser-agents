# Phase 00: Validate the hard constraints

Status: planned.

## Outcome

Choose an agent framework and a browser execution boundary using small,
executable experiments. Resolve compatibility and isolation before building
the full application.

## Work

- [ ] Build a minimal browser-worker bundle using Deep Agents' TypeScript
  package. Exercise planning, an in-memory file tool, and a fake model adapter.
  Identify Node-only imports, incompatible storage assumptions, and bundle cost.
- [ ] If it cannot meet the requirements cleanly, evaluate Testbed's AI SDK
  approach or a small explicit loop against the same tool and event contracts.
  Record why the selected approach is sufficient. Do not maintain two runtimes.
- [ ] Prove one real streamed model/tool round trip through a disposable local
  relay. Keep credentials outside the worker executing generated code. Use fake
  streams for deterministic development and user-supplied credentials for the
  real check; do not commit keys or private prompts.
- [ ] Load Pyodide with NumPy, pandas, and matplotlib. Read an input file,
  calculate a result, and return a PNG and text output without freezing the UI.
- [ ] Evaluate a separate execution origin or equivalent enforceable boundary.
  Document the role of iframe sandboxing, worker policy, CSP, asset loading,
  message validation, and denial of network paths. Treat these as candidates
  to test, not an assumption that one header provides a complete sandbox.
- [ ] Test Python HTTP attempts, JavaScript fetch and other available network
  channels, access to the relay, cross-chat files, and credential storage.
  Test after approved packages load and during interpreter startup.
- [ ] Stop an infinite loop by terminating execution. Confirm the trusted UI
  can recover and files already persisted outside the interpreter remain intact.
- [ ] Measure cold startup and basic memory behavior on the development device.

## Deliverables

Keep experiments in a clearly marked development area. Write
`docs/technical-findings.md` with exact tested versions, browser, commands,
results, selected design, rejected approaches, and remaining limitations.
Document how generated code receives files and how runtime assets load without
allowing that code to make network requests.

## Exit check

The chosen framework bundles in the browser and supports the required loop.
Python produces files and can be stopped. Adversarial probes cannot reach
credentials, other workspaces, the relay, or external endpoints through the
supported execution environment. Record evidence and limits; passing a few
probes alone is not proof of a complete security boundary.

If isolation fails, investigate a stricter browser execution design. Do not
replace browser execution with a server or allow network access without a
product-scope decision. Foundation work may proceed, but automatic Python
execution cannot be declared ready while this requirement is unresolved.
