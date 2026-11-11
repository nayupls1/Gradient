import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { GithubSync } from "./GithubSync.ts"
import { imageContentType } from "./icons.ts"

/**
 * Images from linked repositories, such as project icons:
 * `/repo-files/<repo id>/<blob sha>/<file name>`. Gradient fetches them with
 * its own token, so private repositories work, and caches them by sha, so the
 * URL never changes meaning and the browser may keep it forever. The file name
 * only picks the content type; anything that is not an image is refused.
 *
 * SVGs can carry scripts. `<img>` never runs them, and opened on their own the
 * CSP sandbox keeps them away from the app's origin.
 */
export const RepoFileRoute = HttpRouter.add(
  "GET",
  "/repo-files/:repoId/:sha/:name",
  Effect.gen(function*() {
    const { repoId, sha, name } = yield* HttpRouter.params
    const contentType = imageContentType(name ?? "")
    if (!repoId || !sha || !contentType || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    const sync = yield* GithubSync
    return yield* sync.fileBytes(repoId, sha).pipe(
      Effect.map((bytes) =>
        HttpServerResponse.uint8Array(bytes, {
          contentType,
          headers: {
            "cache-control": "private, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox"
          }
        })
      ),
      Effect.catchTag("GithubError", (e) => Effect.succeed(HttpServerResponse.text(e.message, { status: 404 })))
    )
  })
)
