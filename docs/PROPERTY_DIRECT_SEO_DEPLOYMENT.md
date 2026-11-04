# Property Direct SEO deployment

`/book/[slug]` is public. It uses the anonymous public Property API, not an
Owner API, invitation, context token or visitor-origin check. Checkout and its
trusted policy-2 attribution are unchanged.

## Required configuration

- Set `NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN` to the real public frontend HTTP(S)
  origin before building. No path, credentials, query or fragment; non-local
  production origins require HTTPS. It is embedded in the frontend at build
  time: changing it requires rebuilding and redeploying. There is no fallback
  to the dashboard host or backend host.
- Set server-only `KOOCH_BACKEND_ORIGIN` at runtime to the API origin. Production
  has no default. It is used only for anonymous server API reads, never for
  canonical/social URLs. The existing frontend `/uploads` rewrite must serve
  the real public upload images on the configured public frontend.
- Missing/invalid public origin is an SEO deployment blocker: pages retain
  their real content, but omit canonical/image URLs; sitemap returns no URLs
  and logs a configuration warning. Never deploy this as SEO-ready.
- No API failure is treated as an empty successful Property list or a missing
  Property. Actual public-API 404/non-Approved results use Next `notFound()`.

## Behavior and limits

Metadata and HTML use request-time, anonymous, no-store public Property reads;
React request memoization shares the detail read between metadata and page.
The existing interactive landing receives that public DTO as initial data.
No authenticated headers, cookies, booking commands or database access are
introduced. A later publication change is checked on the next server request.

Canonical URLs self-reference `/book/{encodedSlug}` without query parameters.
Marketplace `/properties/[slug]` metadata is unchanged and is not redirected
or canonicalized to Direct. There was no previous sitemap or robots file.
The new sitemap lists eligible Direct pages once, from a single list call;
no per-Property fetch or fabricated modification date. A deployment exceeding
50,000 URLs must partition the sitemap before release. The existing list API
is unpaginated and returns full public DTOs; monitor its size and latency.

Structured data uses `LodgingBusiness`, verified text/address/coordinates and
a real public image when suitable. It asserts no ratings, prices, offers or
availability. Image syntax and public URL shape are checked, not remote asset
reachability; verify images manually. No stock-image SEO fallback is added.

Robots permits public crawling and discourages private/dashboard/checkout/API
routes. Robots is not an access-control mechanism; existing authorization is
unchanged. Unknown/unpublished Direct pages use `notFound()` and Next's noindex
handling. API/network failures remain errors, not fabricated public content.

## Release/manual checks

1. Build with the actual public origin and deploy with the correct API origin.
2. Inspect the initial HTML (JavaScript disabled), status, title, description,
   single Direct canonical, OG/Twitter image URL and JSON-LD on a real Approved
   Property, including a URL with booking/tracking query parameters.
3. Verify a non-public/missing Property is not indexable. Check reverse proxy
   caches do not retain public pages after approval is revoked.
4. Fetch `/robots.txt` and `/sitemap.xml` on the actual public host. Check sitemap
   count, Approved-only inclusion and latency; verify image URLs anonymously.
5. Validate structured data/social previews and submit the sitemap in Google
   Search Console. Use URL Inspection to check Google's selected canonical.

Self canonicals distinguish the intended entry routes, but content overlaps
with Marketplace. Google can still choose one canonical or decline indexing;
metadata/sitemap availability does not prove Google indexing or rich results.
