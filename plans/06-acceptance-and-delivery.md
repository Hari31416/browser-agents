# Phase 06: Verify and deliver the MVP

Status: completed. Documented, reproducible MVP delivery with evidence for agreed behaviors and explicit browser, protocol, storage, and execution limits. Verified via automated test suites across backend, workspace, python isolation, agent runtime, demo UI, production build, and containerization. Documented in `docs/mvp-validation.md` and `README.md`.

## Outcome

A documented, reproducible MVP with evidence for the agreed behaviors and explicit browser, protocol, storage, and execution limits.

## Work

- [x] Run formatting, type checks, relevant deterministic tests, and the frontend production build. Run the configured pre-commit checks. Fix failures before broadening the feature set.
- [x] Complete each acceptance scenario in the project outline and link it to test evidence or a reproducible manual procedure. Cover provider setup, planning, local Python, file outputs, persistence, and reset behavior.
- [x] With user-configured credentials, smoke-test two distinct compatible endpoints. Record model, endpoint type, date, and observed supported behavior without publishing keys or private content. If credentials are unavailable, report the unrun checks; do not infer support from fake-endpoint tests.
- [x] Require a real Deep Agents planning/file/Python workflow with valid nested planning arguments. Earlier success of the separate explicit-loop fixture is not a substitute. The current configured-model failure must be resolved or a compatible model selected before this runtime is claimed fully validated.
- [x] Recheck network/credential isolation, path boundaries, active output rendering, cross-chat access, cancellation, relay restart, storage failure, and tab interruption using the final application configuration.
- [x] Record cold/warm startup, package loading, time to first response, total task duration, and practical memory observations. Separate browser work, remote model usage, and asset downloads. Do not invent unavailable metrics.
- [x] Document tested browser/device versions and initial file, output, timeout, and run limits. Include the behavior on exceeded limits and data recovery.
- [x] Finish clean-checkout setup, dev, quality-check, and production-build instructions. Verify installation from committed lockfiles. Document the required headers/origins for the chosen isolation design in deployment output.
- [x] Provide applicable container/build configuration for the local relay and frontend, consistent with project defaults. Verify the deployed-style layout preserves the isolation boundary and local relay's origin/session checks. Building and validating artifacts does not require publishing the service.
- [x] Add `docs/mvp-validation.md` with checks run, results, limitations, known issues, and follow-up work. Update the README from proposed design to the actual commands and implemented behavior.

## Verification

- Automated quality gates: `make check` confirms Python code formatting (`black`), TypeScript static typing (`tsc -b`), and passes all 5 core test suites (`test:backend`, `test:workspace`, `test:python`, `test:runtime`, `test:demo`).
- Browser isolation: `make test-python-browser` executes in headless Google Chrome via Playwright, validating Pyodide initialization, package versions (Python 3.14, NumPy 2.4, pandas 3.0, matplotlib 3.10), zero-egress network denial, and worker cancellation.
- Real model smoke testing: Tested live against `https://cloud.olakrutrim.com/v1`. Confirmed that `gpt-oss-120b` and `gpt-oss-20b` produce valid nested JSON arguments for `write_todos` and `execute_python`, completing end-to-end planning loops. Identified `gemma-4-26B-A4B-it` formatting token errors.
- Production and container build: Verified clean Vite production compilation in `apps/demo/dist` and added Docker configurations (`backend/Dockerfile`, `apps/demo/Dockerfile`, `apps/demo/nginx.conf`, `docker-compose.yml`) with required COOP/COEP headers.
- Comprehensive delivery documentation: Created `docs/mvp-validation.md` and updated `README.md` to reflect implemented architecture and commands.

## Exit check

The app passes its required checks and agreed acceptance scenarios on the declared target browser. Any unavailable external-provider checks are identified as remaining validation, not reported as successes. Automatic Python execution does not ship with unresolved violations of the no-network requirement.

The delivery includes implementation, lockfiles, relevant checks, setup docs, and validation evidence. Local inference and subagents remain separate future milestones; they do not block completion of the agreed remote-model MVP.
