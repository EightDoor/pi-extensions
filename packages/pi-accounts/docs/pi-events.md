# Pi events for pi-accounts

`pi-accounts` uses Pi's process-local `pi.events` bus to communicate with other trusted extensions. These are versioned event channels, **not** `pi.on()` lifecycle events, cross-process messages, or a security boundary. Register consumers through Pi's public `ExtensionAPI`; no import from `pi-accounts` or read of its credential file is needed.

| Channel | Purpose | Response timing | Secrets in response? |
| --- | --- | --- | --- |
| `accounts:topology:v1` | Discover configured named accounts and user-wide defaults | Asynchronous `reply` | No |
| `accounts:activation:v1` | Select and verify a named account for one session, or restore Pi auth | Asynchronous `reply` | No |
| `oauth:credential-readiness:v1` | Obtain a promise for the current provider's session-owned auth sync | Synchronous `waitUntil` registration; promise settles later | No credential payload; handle rejections privately |
| `oauth:credential-source:v1` | Request the verified active OAuth credential for a session and provider | Synchronous `offer` during `emit()` | **Yes** |

`pi.events.emit(channel, request)` starts registered listeners synchronously and returns `void`; it does **not** await their work. Only the credential-source offer is collected synchronously. Topology and activation callbacks can run after `emit()` returns. Pi tracks and removes subscriptions from a stale extension runtime; session-owned state is separately invalidated on replacement and shutdown.

## Named account topology

```ts
pi.events.emit("accounts:topology:v1", {
  reply(topology) {
    // topology.providers contains configured accounts, not remotely verified accounts.
  },
});
```

The request needs a callable `reply`. A successful reply has this shape:

```ts
type AccountTopology = {
  providers: Array<{
    providerId: string;
    displayName: string;
    accounts: Array<{ name: string; kind: "oauth" | "api-key" }>;
    defaultAccount?: string;
  }>;
};
```

`providers` includes each supported adapter, including ones with no accounts. Names are user-defined identifiers; do not mistake them for credentials. `defaultAccount` is present only when a named user-wide default is configured. It is **not** the account selected in the current session. The reply waits for queued credential writes in this store; a failed storage read produces **no reply**. There is no model inventory, health check, quota report, or remote authentication guarantee.

## Explicit session activation

Emit this request after `session_start` for the exact session that should change:

```ts
pi.events.emit("accounts:activation:v1", {
  session: ctx.sessionManager, // object identity, not the session ID string
  provider: "openai",        // Pi provider ID
  account: "work",           // null restores Pi's built-in auth, not the named default
  model: "gpt-4o",           // optional model ID for account-specific availability
  signal: controller.signal, // optional AbortSignal
  reply(result) {
    // Check result.status and result.code before dependent work.
  },
});
```

`session` must be the current `ctx.sessionManager` object. `provider` must be a nonempty supported provider ID; `account` must be a valid exact account name or `null`. `model`, if supplied, must be a nonempty string. Malformed envelopes (including an invalid signal or callback) are ignored without a reply. An unsupported provider in a *well-formed* request receives `provider_unsupported` instead. The optional model check uses the selected account's availability after activation; Pi's ModelRegistry remains authoritative for models in general. Restoring Pi auth does not check the optional model.

The result is one of:

```ts
type AccountActivationResult =
  | { status: "active"; providerId: string; accountName: string }
  | { status: "inactive"; providerId: string; accountName: null }
  | {
      status: "error";
      providerId: string;
      accountName: string | null;
      code: AccountActivationErrorCode;
    };
```

`active` means the requested named authentication was applied and verified against effective runtime auth, **not** that a remote request succeeded. `inactive` means Pi's built-in authentication was restored, not that its remote credentials are valid. Errors carry no raw provider or storage exception text. `providerId` and `accountName` reflect the request, including on errors; do not parse them as diagnostics.

| Error code | Meaning |
| --- | --- |
| `account_not_found` | Invalid or missing named account. |
| `authentication_failed` | Credential refresh, conversion, or default-auth restoration failed. |
| `store_unavailable` | Credential storage could not be read or the selection could not be persisted. |
| `effective_auth_conflict` | Configured runtime auth prevents the selected credential from taking effect. |
| `model_unavailable` | The optional model is not available to the selected account. |
| `activation_superseded` | A newer explicit selection changed the request's ownership. |
| `session_unavailable` | The supplied session has no current owner or was replaced or shut down. |
| `provider_unsupported` | This responder does not manage that provider. |
| `cancelled` | The request's signal was aborted. |
| `activation_failed` | Another activation failure not classified above. |

A pre-aborted request changes no selection. A valid request can persist the session selection **before** runtime activation succeeds; failure or cancellation after that point does not roll it back. Failed auth may leave that provider fail-closed rather than falling back to another account. A newer explicit selection supersedes pending work, but a routine model/turn sync of the same selection does not. Aborting the consumer's request stops its wait for a replacement sync without cancelling the session's shared sync. Recheck the current session and requested account after every wait before starting dependent work. A reply from an old session must not authorize work in a new one.

## Verified OAuth credential handoff

`oauth:credential-readiness:v1` accepts `{ session: ctx.sessionManager, provider: "openai", waitUntil(pending) { /* retain pending */ } }`. The callback runs during `emit()` and receives a promise for the current provider sync, including a replacement sync when one supersedes the pending task. If no matching session/provider owner responds, there is no `waitUntil` call. The promise can reject; consumers must handle rejection and bound their own wait. This channel itself does not provide credentials or select an account.

After readiness, `oauth:credential-source:v1` accepts `{ session: ctx.sessionManager, provider: "openai", offer(credential) { /* validate and clone now */ } }`. Matching active OAuth credentials are offered **synchronously** during `emit()`; a named API key, Pi default, pending, failed, replaced, or shut-down state offers nothing. The offer is a defensive clone of the verified credential. Collect candidates before `emit()` returns, then validate the credential against freshly resolved runtime authentication using provider-specific metadata. Never cache, log, persist, or display an offered token. Multiple conflicting candidates must fail closed rather than choosing the first listener.

The extension-neutral [OAuth Credential Source Protocol v1](https://github.com/narumiruna/pi-extensions/blob/main/docs/api/oauth-credential-source-v1.md) defines the full consumer verification and conflict-handling contract. Credential-source and readiness are optional: without a compatible consumer, account activation works normally; without a compatible owner, a consumer must follow its own fail-closed or Pi-auth fallback policy.

## Failure, ownership, and compatibility

With no compatible responder, no topology or activation callback arrives. Bound each asynchronous wait, abort requests that are no longer needed, and do not start dependent work on a timeout. A timeout **does not** prove activation did not happen. Callbacks may throw without disrupting the owner, but consumers should avoid throwing and should handle late or duplicate replies. Only one account infrastructure responder should own the `accounts:*:v1` channels; a first reply is not proof of exclusive ownership, so treat detected duplicates as a conflict.

All four channels are process-local and versioned by suffix. Unknown versions have no implied compatibility. The account channels expose identifiers but no credential material; the OAuth credential-source channel deliberately offers secrets only to trusted in-process consumers. Pi extensions already run with the user's file and memory permissions, so install only trusted extensions. These channels do not provide automatic rotation, failover, usage, quota, model discovery, or routing policy.
