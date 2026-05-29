/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/game-timer",
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
