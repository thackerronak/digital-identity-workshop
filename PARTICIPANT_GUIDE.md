# Participant Guide: Build Your Own Verifiable Credential & Verifier Tab

This guide provides workshop participants with everything needed to add a **custom Verifiable Credential** (e.g. University Degree, Airport Boarding Pass, Digital Driver's License, KYC Identity) and build an **interactive Verifier Tab** with automated business rules using Antigravity.

---

## ⚡ The Quickest Way: Ask Antigravity

Antigravity includes a built-in skill: **[`onboard-credential-flow`](.agents/skills/onboard-credential-flow/SKILL.md)** that knows the complete architecture of Keycloak OID4VCI, the digital wallet registry, and the OID4VP verifier engine.

### How to Use the Skill in Chat:
Copy and paste any of the example prompts below directly into Antigravity, or customize the fields for your own domain!

```text
I want to onboard a new [Domain] credential for [Scenario/Tab Name] with claims [list of claims].
Please use the onboard-credential-flow skill to implement the end-to-end flow.
```

---

## 🚀 Ready-to-Run Example Prompts

Choose any scenario below and paste the prompt directly into Antigravity:

### 🎓 Scenario 1: University Degree & Graduate Fellowship Portal
> **Domain**: Education / Academic Credentials  
> **Use Case**: Prove graduation credentials to automatically unlock graduate fellowship scholarships.

**Prompt to copy & paste:**
```text
I want to onboard a new University Degree credential (https://stanford.edu/degree) with scope 'university-degree' and claims:
- degree_name (e.g. "B.S. Computer Science")
- graduation_year (e.g. "2024")
- gpa (e.g. "3.92")
- honors_status (e.g. "Summa Cum Laude")
- student_id (e.g. "STAN-8841")

Create a new verifier tab 'Alumni Fellowship' (data-tab="alumni_fellowship") that verifies this degree and applies the following rule:
- If GPA >= 3.5 or honors_status is "Summa Cum Laude", award a "100% Full-Tuition Graduate Fellowship & Research Grant ($45,000)".
- Otherwise, award "Standard Alumni Membership".

Please use the onboard-credential-flow skill to implement the entire flow end-to-end.
```

---

### ✈️ Scenario 2: Airport Boarding Pass & TSA Priority Lane
> **Domain**: Travel & Aviation  
> **Use Case**: Zero-touch airport security turnstile that selectively discloses travel status to open priority lanes.

**Prompt to copy & paste:**
```text
I want to onboard an Airline Boarding Pass credential (https://skyteam.example/boarding-pass) with scope 'boarding-pass' and claims:
- flight_number (e.g. "UA-428")
- seat_number (e.g. "12A")
- passenger_name (e.g. "Ronak Patel")
- tsa_precheck (e.g. "true")
- frequent_flyer_tier (e.g. "Platinum Medallion")

Create a new verifier tab 'Priority Security Lane' (data-tab="fast_track") that verifies this credential:
- If tsa_precheck is "true" or frequent_flyer_tier contains "Platinum", grant "Fast-Track Priority Security Access (Gate 43)".
- Otherwise, route to "Standard Security Line".

Please use the onboard-credential-flow skill to implement the entire flow end-to-end.
```

---

### 🚗 Scenario 3: Digital Driver's License & Express Car Rental
> **Domain**: Government Identity / DMV  
> **Use Case**: Car rental checkout where the customer proves legal driving age without oversharing full birthdates or addresses.

**Prompt to copy & paste:**
```text
I want to onboard a Digital Driver License credential (https://dmv.example/driver-license) with scope 'driver-license' and claims:
- license_number (e.g. "DL-904281")
- issue_state (e.g. "California")
- age_over_21 (e.g. "true")
- organ_donor (e.g. "true")

Create a new verifier tab 'Express Car Rental' (data-tab="car_rental") that:
- Selectively requests only 'license_number' and 'age_over_21'.
- If age_over_21 is "true", approves instant checkout for "Luxury Sports Sedan ($0 Deposit)".
- If age_over_21 is not true, prompts for "Underage Driver Insurance Waiver Required".

Please use the onboard-credential-flow skill to implement the entire flow end-to-end.
```

---

### 🛡️ Scenario 4: KYC Identity Badge & High-Value Banking
> **Domain**: Fintech & Banking  
> **Use Case**: Reusable cryptographic KYC that unlocks international wire limits without re-submitting passport scans.

**Prompt to copy & paste:**
```text
I want to onboard a KYC Identity Badge credential (https://kyc.example/id-badge) with scope 'kyc-badge' and claims:
- national_id (e.g. "KYC-IND-99201")
- kyc_tier (e.g. "Tier 3 (Enhanced)")
- residential_country (e.g. "United States")
- verification_status (e.g. "Verified")

Create a new verifier tab 'Wealth Management Onboarding' (data-tab="wealth_mgmt") that:
- If kyc_tier is "Tier 3 (Enhanced)", unlocks "Unlimited International Wire Transfers & Dedicated Private Banker".
- Otherwise, applies "Standard $10,000 Daily Limit".

Please use the onboard-credential-flow skill to implement the entire flow end-to-end.
```

---

## 📝 Custom Domain Prompt Template

Want to build your own unique credential? Fill out this blank template:

```text
I want to onboard a new [Domain Name] credential ([VCT URI]) with scope '[scope-id]' and claims:
- [claim_1] (e.g. "[sample_value]")
- [claim_2] (e.g. "[sample_value]")
- [claim_3] (e.g. "[sample_value]")

Create a new verifier tab '[Tab Title]' (data-tab="[tab_id]") that:
- Requests [list of selective disclosures].
- Rule: If [condition], unlock [premium outcome]; otherwise [default outcome].

Please use the onboard-credential-flow skill to implement the entire flow end-to-end.
```

---

## 🔍 How to Test After Antigravity Implements Your Credential

1. **Verify automated test suite**:
   ```bash
   npm test
   ```
2. **Collect Your New Credential (OID4VCI)**:
   - Visit the Issuer Welcome Portal: **`http://localhost:8080/`**
   - Log in with `ronak` (password: `workshop`).
   - Switch to your new credential card and click **"Add to Your Wallet"**.
   - Your digital wallet at `http://localhost:3001/` will accept and store the new credential!
3. **Verify in Portal (OID4VP)**:
   - Visit the Verifier Portal: **`http://localhost:4000/`**
   - Click on your new tab.
   - Click **"Present with Web Wallet"** (or scan the QR code with your mobile wallet camera).
   - Watch your custom business rule calculate and display the verified result!
