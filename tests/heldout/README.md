# Held-out evaluation set

Add owner-controlled JSON files here using this shape:

```json
{
  "name": "case name",
  "text": "document text",
  "expected": {
    "principal": 10000,
    "rate": 9.9,
    "term": 36,
    "payment": 320.00,
    "docType": "installment_loan",
    "band": "high"
  }
}
```

Omit fields that are not stated or applicable. The harness reads these files as-is; the analyzer and dev tests do not import or depend on them. Held-out documents are git-ignored by default.
