#!/bin/bash
# One-command setup for Kothari Synthetic Industries Dashboard
# Run: curl -s https://raw.githubusercontent.com/kotharivijay/vinodindustries/main/setup.sh | bash
# Or after cloning: bash setup.sh

set -e

echo "🏭 Kothari Synthetic Industries — Setup"
echo "========================================"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not installed. Download from https://nodejs.org"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ Git not installed. Download from https://git-scm.com"; exit 1; }

echo "✅ Node $(node -v) | Git $(git --version | cut -d' ' -f3)"

# Clone if not already in repo
if [ ! -f "package.json" ]; then
  echo "📦 Cloning repository..."
  git clone https://github.com/kotharivijay/vinodindustries.git
  cd vinodindustries
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Login to Vercel and pull env vars
echo "🔗 Connecting to Vercel..."
npx vercel login
npx vercel link --yes
npx vercel env pull .env.local

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

echo ""
echo "✅ Setup complete!"
echo ""
echo "Run the app:  npm run dev"
echo "Open:         http://localhost:3000"
echo "Deploy:       npx vercel --prod"
echo ""
