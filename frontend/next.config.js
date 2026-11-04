/** @type {import('next').NextConfig} */
const apiUrl = new URL(process.env.COFFER_API_URL ?? "http://127.0.0.1:4000");
if (
  !["http:", "https:"].includes(apiUrl.protocol) ||
  apiUrl.username ||
  apiUrl.password ||
  apiUrl.pathname !== "/" ||
  apiUrl.search ||
  apiUrl.hash
) {
  throw new Error(
    "COFFER_API_URL must be an HTTP(S) origin without credentials",
  );
}

const apiOrigin = apiUrl.origin;

module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/coffer/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};
