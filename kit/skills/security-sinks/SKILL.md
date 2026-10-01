---
name: security-sinks
description: Dangerous-API sink taxonomy, GitHub Actions workflow-injection fields, and IaC/IAM high-miss review patterns. Use when editing Terraform, Python, JS/TS, or GitHub Actions workflow files, or reviewing a diff that touches parsing, deserialization, shell execution, TLS, crypto, or permission grants.
paths:
  - "**/*.tf"
  - "**/*.py"
  - "**/*.js"
  - "**/*.ts"
  - "**/.github/workflows/*"
context: fork
---

# Security sinks

Salvaged from the security-guidance plugin's rule data (disabled 2026-09-11 — its per-prompt
`git stash create` and Python-per-edit machinery cost more than the rules were worth). This is the
data only: a checklist to run mentally against a diff, not an enforced hook.

## Sinks

- **child_process_exec** — `exec()`/`execSync()` (JS) runs a shell, injectable via interpolated input — use `execFile()`/`spawn()` with an argument array.
- **new_function_injection** — `new Function()` with interpolated strings is code injection — never interpolate untrusted strings into it.
- **eval_injection** — `eval()` executes arbitrary code — use `JSON.parse()`, `ast.literal_eval()`, or a safe expression parser.
- **react_dangerously_set_html** — `dangerouslySetInnerHTML` is an XSS sink — sanitize with DOMPurify first.
- **document_write_xss** — `document.write()` is an XSS sink — use `createElement()`/`appendChild()`.
- **innerHTML_xss** / **outerHTML_xss** — assigning `.innerHTML`/`.outerHTML` is an XSS sink — use `textContent`, or DOMPurify if HTML is required.
- **insertAdjacentHTML_xss** — same sink family — use `insertAdjacentText()`/DOMPurify.
- **pickle_deserialization** / **pickle_variants_load** (cPickle/cloudpickle/dill) / **pickle_wrapper_load** (joblib.load, pandas.read_pickle, numpy.load with allow_pickle=True) / **marshal_loads** / **shelve_open** — all unpickle untrusted data, allowing arbitrary code execution — use JSON or a schema-validated deserializer (msgspec, pydantic).
- **os_system_injection** — `os.system()` runs a shell — use `subprocess.run([...])` with a list.
- **python_subprocess_shell** — `subprocess.*(shell=True)` enables command injection — pass args as a list without `shell=True`.
- **go_exec_shell_injection** — `exec.Command("sh"/"bash", ...)` enables command injection — pass args directly, no shell.
- **unsafe_yaml_load** / **yaml_unsafe_load_variants** — `yaml.load()`/`yaml.unsafe_load()` execute arbitrary Python via `!!python/object` tags — use `yaml.safe_load()`.
- **torch_unsafe_load** — `torch.load()` defaults to unpickling — pass `weights_only=True`.
- **xml_unsafe_parse** — stdlib `ElementTree`/`minidom`/`xml.sax` parse is vulnerable to XXE and billion-laughs — use `defusedxml`.
- **node_createcipher_no_iv** — `crypto.createCipher()` has no IV and a weak KDF — use `createCipheriv()`.
- **aes_ecb_mode** — AES-ECB leaks plaintext structure — use AES-GCM or AES-CBC with HMAC.
- **tls_verification_disabled** — `verify=False`, `rejectUnauthorized:false`, `InsecureSkipVerify`, `NODE_TLS_REJECT_UNAUTHORIZED=0` all allow MITM — trust a proper CA instead.
- **script_src_without_sri** — a `<script src=…>` with no `integrity=` is exposed to CDN compromise — add Subresource Integrity.
- **github_actions_workflow** — untrusted event fields interpolated into `run:` is command injection — see below.

## GitHub Actions untrusted input

Never interpolate these directly into a `run:` step (`echo "${{ github.event.issue.title }}"`);
pass them through `env:` with quoting instead (`env: { TITLE: ... }` then `echo "$TITLE"`):

`github.event.issue.title`, `.issue.body`, `.pull_request.title`, `.pull_request.body`,
`.comment.body`, `.review.body`, `.review_comment.body`, `.pages.*.page_name`,
`.commits.*.message`, `.head_commit.message`, `.head_commit.author.email`,
`.head_commit.author.name`, `.commits.*.author.email`, `.commits.*.author.name`,
`.pull_request.head.ref`, `.pull_request.head.label`,
`.pull_request.head.repo.default_branch`, `.client_payload.*` (repository_dispatch — attacker
sets any field), `github.head_ref`.

**Ref injection**: never use untrusted input in `ref:` on `actions/checkout`. For
`client_payload.pr_number`, validate `^[0-9]+$` before using in
`ref: refs/pull/${{ ... }}/head`.

## High-miss review patterns

Check only against added lines in a diff — do not flag pre-existing code read while exploring.

- **Sensitive data to logs** — an added line emits to a log/trace/span/metric/exception-message sink. Trace every field (URLs, paths, `.message`, f-string vars, kwargs) to its source; flag credentials, PII, or customer content reaching it — especially on error paths where happy-path redaction is bypassed.
- **IaC omitted-argument default** — an added line instantiates a Terraform/Pulumi/CDK module and omits an optional security-relevant argument. Read the module's variable defaults — an omitted arg is a finding only if the default is the insecure value.
- **Over-broad grant when a narrower mechanism exists** — an added line grants a principal broad-scope access (global allowlist, standing admin role, reused credential) while the same file or module already exposes a narrower mechanism for the same need. Do not flag if no narrower mechanism is visible in the changed files.
- **Fail-open state drift** — a security decision reads parsed/cached/tracked state; verify error, cancellation, TOCTOU, and unhandled-variant paths don't default to the allow outcome (broad-except-pass, `unwrap_or({})`, missing cleanup, stale validator maps).
- **Gate/action field mismatch** — an added or modified authorization check reads one field to decide, while the downstream operation selects its target from a different field. If they diverge, the gate is bypassable.
- **Security-registry fanout** — an added line introduces a new entity (field, enum, credential type, scope) that should appear in every registry keyed on that class (sanitizer lists, redaction sets, revocation handlers, capability allowlists). Grep for the sibling registries and flag any that are missing the new entry.
