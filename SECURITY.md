{
  "name": "outwork-app",
  "version": "1.0.0",
  "private": true,
  "description": "Outwork: group workout challenges. Express server with a Postgres database.",
  "main": "server/index.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "migrate": "node server/db.js"
  },
  "dependencies": {
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "helmet": "^8.0.0",
    "pg": "^8.13.1"
  }
}
