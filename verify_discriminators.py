import hashlib

def get_anchor_discriminator(name):
    preimage = f"global:{name}"
    return hashlib.sha256(preimage.encode()).digest()[:8].hex()

print(f"initialize_allowlist: {get_anchor_discriminator('initialize_allowlist')}")
print(f"set_wallet_status: {get_anchor_discriminator('set_wallet_status')}")
