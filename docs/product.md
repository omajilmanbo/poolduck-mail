# Product definition (MVP)

## 1. Target customers

- Small and medium-sized enterprise operations team (with batch notification or voucher delivery requirements)
- Customer service/warehousing/store scenarios (use a code scanner for quick entry)
- Multi-organization customers who need to isolate data by tenant

## 2. Business problem (Problem)

- Customers need a Web SaaS for centralized management of business data, email notifications, customer accounts and subscription permissions.
- In the current process, the email matching and email sending process after scanning the QR code lacks a unified system.
- It is necessary to ensure permission boundaries, subscription status control and operation traceability in multi-tenant scenarios.

## 3. MVP Goal

- Provide basic capabilities of Web SaaS, supporting login, tenant management, and subscription verification
- Receive QR code scanning events and generate email tasks based on rules
- Provide email task status tracking and basic auditing
- Verify the core business closed loop under the premise of minimizing functions

## 4. MVP scope (In Scope)

- Tenant and user models
- Login authentication (basic account password or later expandable SSO)
- Subscription status check (license check)
- Scan code event collection API
-Draft of email task generation and sending interface
- Basic backend management capabilities (tenant query, subscription status viewing)

## 5. MVP does not do (Out of Scope)

- Desktop client and local offline mode
- Complex workflow orchestration and custom scripts
- Full BI reporting system
- Multi-region disaster recovery and enterprise-level advanced compliance (SOC2/ISO certification implementation)
- Large-scale third-party market plug-in system
