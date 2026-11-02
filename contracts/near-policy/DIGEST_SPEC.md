# `coffer:proposal:v1` digest

The digest is SHA-256 over this exact byte sequence:

1. `coffer:proposal:v1` as a 4-byte big-endian length followed by UTF-8 bytes.
2. Organization commitment: exactly 32 bytes.
3. Proposal type: length-prefixed UTF-8, maximum 32 bytes.
4. Proposal ID commitment: exactly 32 bytes.
5. Revision: unsigned 64-bit big-endian.
6. Policy version: unsigned 64-bit big-endian.
7. Policy digest: exactly 32 bytes.
8. Chain ID: length-prefixed UTF-8, maximum 64 bytes.
9. Canonical asset ID: length-prefixed UTF-8, maximum 192 bytes.
10. Atomic amount: unsigned 128-bit big-endian.
11. Authorized maximum: unsigned 128-bit big-endian.
12. Recipient commitment: exactly 32 bytes.
13. Expiry in nanoseconds: unsigned 64-bit big-endian.
14. Nonce: exactly 32 bytes.
15. Idempotency-key commitment: exactly 32 bytes.
16. Operation: length-prefixed UTF-8, maximum 64 bytes.
17. Environment: length-prefixed UTF-8, maximum 32 bytes.

Every variable-length field uses a 4-byte unsigned big-endian byte length.
Symbols, display amounts, invoice text, payroll data, names, AI text, and
provider responses are not digest inputs. TypeScript must reproduce a checked-in
golden vector before the backend contract adapter can be accepted.
