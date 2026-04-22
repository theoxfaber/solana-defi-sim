#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}--- Starting Solana DeFi Simulation Harness ---${NC}"

# 1. Check prerequisites
echo -e "\n${GREEN}[1/4] Checking Prerequisites...${NC}"
if ! command -v solana &> /dev/null; then
    echo -e "${RED}✗ solana-cli not found. Install: https://docs.solana.com/cli/install-solana-cli-tools${NC}"
    exit 1
fi

if [ ! -f "asymmetric_spl/programs/asymmetric_spl/src/lib.rs" ]; then
    echo -e "${RED}✗ Contract source missing!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Prerequisites verified.${NC}"

# 2. Setup environment
echo -e "\n${GREEN}[2/4] Setting up Environment...${NC}"
cd liquidity_manager
if [ ! -f ".env" ]; then
    echo "Generating fresh authority keypair..."
    node create_env.js
fi
npm install --quiet
echo -e "${GREEN}✓ Environment ready.${NC}"

# 3. Deploy pool
echo -e "\n${GREEN}[3/4] Deploying Liquidity Pool...${NC}"
node deploy_pool.js
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Liquidity Pool Initialized!${NC}"
else
    echo -e "${RED}✗ Liquidity Manager Failed!${NC}"
    exit 1
fi
cd ..

# 4. Market Simulation (Python)
echo -e "\n${GREEN}[4/4] Running Volatility Agent...${NC}"
cd vol_sim_agent
pip install -r requirements.txt --quiet
python main.py
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Market Simulation Complete!${NC}"
else
    echo -e "${RED}✗ Volatility Agent Failed!${NC}"
    exit 1
fi
cd ..

echo -e "\n${BLUE}--- Full Simulation Finished Successfully ---${NC}"
