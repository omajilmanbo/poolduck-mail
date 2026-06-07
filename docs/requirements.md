# First draft of functional requirements

## 1. System positioning

This system is a Web SaaS for tenant customer companies.
The customer scans the barcode/QR code with a code scanner, and the system finds the corresponding mailbox based on the scan result and sends the email.
The system supports multi-tenancy and allows each tenant to maintain its own correspondence between users, subscriptions, offices/schools, scan code numbers and mailboxes.

---

## 2. First-level function module

### 2.1 Tenant function management

After the tenant administrator logs in to the system, he can enter the tenant function management page to manage the basic data and functional modules of this tenant.

Contains the following submodules:

- Maintain user account subscriptions
- Add or delete offices/schools
- Maintain the corresponding relationship between the scan code number and the email address (personnel list)
- Scan QR codes to send emails (core function)
- Bulk email

---

## 3. Requirements for each module

### 3.1 Maintain user account subscription / office school

Administrators (`root_admin`) can:

- Add, edit and delete user accounts
- Set user roles (`root_admin` / `manager`)
- View and adjust tenant subscription status
- Add or delete offices/schools

This feature requires administrator rights.

The subscription overview needs to be displayed on the "Tenant Function Management" page:
- The number of subscriptions opened by the current tenant (MVP first displays the number of locations allowed in the package and the number used)
- The remaining validity time of the current tenant subscription (calculated based on `end_at`)
- When the remaining time <= 30 days, a renewal reminder will be prompted on this page

Ordinary user (`manager`) restrictions:

- User accounts cannot be maintained
- Subscription status cannot be adjusted
- Cannot add/delete offices or schools
- Only maintenance personnel can be listed (scan code and email mapping)

Detailed rules will be added later.

---



#### 3.1.1 Location quantity addition and same period alignment (MVP billing rules)

When a tenant initially subscribes to 3 locations and subsequently adds 7 more locations before the subscription period ends, the following rules apply:

- The subscription subject is still a single subscription at the tenant level (not split into multiple subscriptions at the location level).
- The newly added 7 locations do not create independent expiration dates and are uniformly aligned with the current tenant subscription `end_at` (co-term).
- The additional quantity will be calculated according to the "remaining period" and the available location quota will be increased immediately after the billing is completed.
- If the supplementary fee confirmation is not completed (such as payment failure/pending confirmation), the newly added location will remain unactivated and will not affect the first 3 locations that have been activated and are still valid.
- After reaching the current `end_at`, press the "Total enabled quantity (example is 10)" to enter the next cycle when renewing.

The goal of this strategy is to prevent one tenant from maintaining multiple sets of different expiration dates at the same time and reduce the complexity of access control and operation and maintenance.

### 3.2 Maintain the corresponding relationship between the scan code number and the email address (personnel list)

Administrators can maintain personnel overview data, which at least includes:

- Scan the code
- Name
-Affiliated office/school
- Corresponding email address
- Status (enabled/deactivated)

Detailed rules will be added later.

---

### 3.3 Scan QR code to send emails (core function)

Scanning QR codes for emails is the core function of MVP.

#### 3.3.1 Preconditions

- The user has logged into the system
- The user has selected an office/school building
- The current tenant subscription status is valid
- The corresponding relationship between QR code scanning number and email address has been maintained

#### 3.3.2 Subscription Limitations

Unified subscription status collection: `trial` / `active` / `expired` / `suspended`.

When the tenant subscription status is:

- `trial` or `active`: allow scanning QR codes and sending emails
- `expired` or `suspended`: prohibit scanning QR code submission and email sending (including manual creation/retry of email tasks)

#### 3.3.3 Page display (UI/UX)

After entering the scan code email page, the system must display the following information block:

- Office/school building switching control (required, scan code submission is disabled when not selected)
- Scan code input area (receives code scanner barcode/QR code)
- Reserved space for send interaction button (currently supports automatic sending after scanning code gun input, or pressing enter to trigger sending, no manual click required)
- List of recent QR code scanning/email sending results (including success/failure status)
- Exception prompt area (used to display errors such as mailbox not found, sending failed, subscription unavailable, etc.)

Subscription status display rules:
- The "remaining subscription time" prompt is not displayed on the scan code sending page.
- When the subscription status is `expired` / `suspended`, the page must display a limit prompt and disable the sending ability
- Renewal reminders and subscription quantity display are unified on the "Tenant Function Management" page

The MVP page does not provide a custom editing area for the email body, nor does it provide a text preview before scanning the QR code to send.

#### 3.3.4 Email body rules

The email body of the MVP stage is generated by the system in a fixed and unified format:

```text
Notice from {tenant_name}, {location_name}: {person_name} completed the action at {time_stamp}.
```

Variable source definition:

- `{tenant_name}`: tenant company name
- `{location_name}`: current office/school name
- `{person_name}`: The name of the person corresponding to the scanned code number
- `{time_stamp}`: room entry time, the format is tentatively `yyyymmddhhmmss`

Example:

```text
Company A, office B is aware of the situation: employee C: Employee 20260520143000 Entering the room.
```

Note: User-defined email text does not belong to the current MVP scope and is reserved as a candidate for subsequent expansion.

#### 3.3.5 QR code scanning process (page operation sequence)
1. The user enters the scan code email page
2. User selects or switches office/school building
3. The system checks the current tenant subscription status
4. If the subscription is `trial` / `active`, enable scanning QR code input
5. The user uses a barcode scanner to scan the barcode/QR code
6. The system receives the scan results and finds the corresponding email address
7. The system generates a fixed format email body (backend internal processing)
8. The system triggers sending and writes back the sending result

#### 3.3.6 When the corresponding mailbox is found
1. Create QR code scanning records
2. Create an email sending task
3. The system generates the email body in a fixed and unified format.
4. The system sends the email to the corresponding mailbox
5. Record email sending results
6. Administrators can view and export history records

#### 3.3.7 When the corresponding email is not found
1. The system prompts "Corresponding email address not found" and remains on the current page.
2. Do not create email sending tasks and do not trigger sending
3. Record abnormal code scanning events
4. The administrator will subsequently confirm and add personnel information

#### 3.3.8 When email delivery fails
1. The system displays "Failed to send email" in the exception prompt area and identifies the cause of the failure.
2. The recent scan/send result list marks the task as failed.
3. Keep scan code and task records for subsequent administrator retries or troubleshooting

#### 3.3.9 Page limit when subscription expires/suspended
1. When the subscription status is `expired` or `suspended`, the page can still be accessed but a restriction prompt must be displayed
2. Disable QR code input and submission actions
3. Prohibit the creation of email tasks and sending actions
4. Guide the user to contact the administrator to handle the subscription status

### 3.4 Mass mailing
The mass email module exists in the functional structure, but detailed rules will be added later.

---

## 4. Currently determined business rules

### 4.1 Multi-tenancy
- Each client company is a tenant
- Each tenant has independent data scope
- Users can only access data of their own tenants
- The login process uses three steps: enter `tenant_id` → enter username/password → enter the business interface
- If `tenant_id` does not exist, it will prompt "tenant does not exist"
- If the user exists but does not belong to the `tenant_id`, login fails
- The backend must verify the existence of `tenant_id` and the user ownership relationship; after successful login, the business interface is still isolated from the tenant context in the backend session

### 4.2 Office/School Dimension
- One tenant can have multiple offices/schools
- Before scanning the email, you need to switch to the current office/school building.
- The name of the office/school must be included in the email content

### 4.3 Email text
MVP stage:
- The text of the email is fixed to `Notice from {tenant_name}, {location_name}: {person_name} completed the action at {time_stamp}. `
- Do not allow the front-end to pass in custom text to overwrite the fixed format
- User-defined email text is used as a candidate for subsequent expansion and does not enter the current MVP

### 4.4 Exception handling
- If the corresponding email cannot be found as a result of scanning the QR code, the email will not be sent.
- Need to record abnormal code scanning events
- Administrators need to be able to subsequently confirm and correct personnel information

---

## 5. Modules currently to be added

The structure of the following modules is temporarily retained and detailed requirements are not expanded:
- Detailed rules for user account and subscription maintenance
- Detailed rules for office/school management
- Detailed rules for personnel maintenance at a glance
- Detailed rules for mass mailing

---
