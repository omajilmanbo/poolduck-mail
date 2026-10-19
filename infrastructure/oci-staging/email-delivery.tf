# ADR-019 / #144: the existing Email Domain and DKIM key must be imported into
# this state before a plan is applied. DNS remains managed by the domain owner.
resource "oci_email_email_domain" "staging" {
  compartment_id = var.compartment_ocid
  name           = var.email_domain_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "oci_email_dkim" "staging" {
  email_domain_id = oci_email_email_domain.staging.id
  name            = var.email_dkim_selector

  lifecycle {
    prevent_destroy = true
  }
}

# This authorizes an address in OCI; it does not enable real sending in the app.
resource "oci_email_sender" "staging" {
  compartment_id = var.compartment_ocid
  email_address  = var.email_sender_address

  depends_on = [oci_email_dkim.staging]

  lifecycle {
    prevent_destroy = true
  }
}

# #141: source default is disabled; staging explicitly enables the approved policy.
resource "oci_identity_dynamic_group" "staging_mail" {
  count          = var.enable_email_instance_principal ? 1 : 0
  compartment_id = var.tenancy_ocid
  name           = "${var.resource_prefix}-email-submit"
  description    = "Only the Poolduck Mail staging Compute instance may use the approved sender."
  matching_rule  = "instance.id = '${oci_core_instance.app.id}'"
}

resource "oci_identity_policy" "staging_mail" {
  count          = var.enable_email_instance_principal ? 1 : 0
  compartment_id = var.tenancy_ocid
  name           = "${var.resource_prefix}-email-submit"
  description    = "Restrict staging Email Delivery submission to one approved sender and domain."
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.staging_mail[0].name} to use approved-senders in compartment id ${var.compartment_ocid} where all {target.approved-sender.emailaddress = '${var.email_sender_address}', target.approved-sender.email-domain = '${var.email_domain_name}'}"
  ]
}

# #142: OCI raw logs can contain recipient PII and incur storage charges.
# Source defaults remain disabled; staging enables them only with approved retention.
resource "oci_logging_log_group" "staging_mail" {
  count          = var.email_log_retention_days == null ? 0 : 1
  compartment_id = var.compartment_ocid
  display_name   = "${var.resource_prefix}-email-delivery"
  description    = "Restricted PII-bearing Email Delivery service logs for staging."
}

resource "oci_logging_log" "outbound_accepted" {
  count              = var.email_log_retention_days == null ? 0 : 1
  display_name       = "${var.resource_prefix}-outbound-accepted"
  log_group_id       = oci_logging_log_group.staging_mail[0].id
  log_type           = "SERVICE"
  is_enabled         = true
  retention_duration = var.email_log_retention_days

  configuration {
    source {
      category    = "outboundaccepted"
      resource    = oci_email_email_domain.staging.id
      service     = "emaildelivery"
      source_type = "OCISERVICE"
    }
  }
}

resource "oci_logging_log" "outbound_relayed" {
  count              = var.email_log_retention_days == null ? 0 : 1
  display_name       = "${var.resource_prefix}-outbound-relayed"
  log_group_id       = oci_logging_log_group.staging_mail[0].id
  log_type           = "SERVICE"
  is_enabled         = true
  retention_duration = var.email_log_retention_days

  configuration {
    source {
      category    = "outboundrelayed"
      resource    = oci_email_email_domain.staging.id
      service     = "emaildelivery"
      source_type = "OCISERVICE"
    }
  }
}

# #142: no additional log-reader policy is granted to the Compute principal.
# The tenancy's sole current Administrator is the designated operator; adding
# further Administrators would widen raw-log access and requires review.
resource "oci_ons_notification_topic" "staging_mail" {
  count          = var.enable_email_delivery_alerts ? 1 : 0
  compartment_id = var.compartment_ocid
  name           = "${var.resource_prefix}-email-delivery-alerts"
  description    = "Staging Email Delivery operational alerts; no recipient data in notifications."

  lifecycle {
    precondition {
      condition     = var.email_log_retention_days != null && var.email_alert_endpoint != null
      error_message = "Email alerts require approved raw-log retention and an operator notification endpoint."
    }
  }
}

resource "oci_ons_subscription" "staging_mail_operator" {
  count          = var.enable_email_delivery_alerts ? 1 : 0
  compartment_id = var.compartment_ocid
  topic_id       = oci_ons_notification_topic.staging_mail[0].topic_id
  protocol       = "EMAIL"
  endpoint       = var.email_alert_endpoint
}

locals {
  email_delivery_stop_metrics = {
    complaint   = "EmailComplaints"
    hard_bounce = "EmailsHardBounced"
    suppressed  = "EmailsSuppressed"
  }
}

resource "oci_monitoring_alarm" "staging_mail_stop" {
  for_each              = var.enable_email_delivery_alerts ? local.email_delivery_stop_metrics : {}
  compartment_id        = var.compartment_ocid
  metric_compartment_id = var.compartment_ocid
  destinations          = [oci_ons_notification_topic.staging_mail[0].topic_id]
  display_name          = "${var.resource_prefix}-email-${each.key}-stop"
  namespace             = "oci_emaildelivery"
  query                 = "${each.value}[1m]{resourceId = \"${oci_email_sender.staging.id}\"}.count() > 0"
  severity              = "CRITICAL"
  is_enabled            = true
  resolution            = "1m"
  body                  = "Staging mail stop signal. Operator must stop real sending and return the application to mock; inspect restricted OCI logs. Do not auto-retry delivery_unknown."
}

# ADR-020: only the existing single-instance Dynamic Group can write this namespace.
resource "oci_identity_policy" "staging_mail_metrics" {
  count          = var.enable_email_application_alerts ? 1 : 0
  compartment_id = var.tenancy_ocid
  name           = "${var.resource_prefix}-email-app-metrics"
  description    = "Write-only staging mail aggregate metrics in one namespace."
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.staging_mail[0].name} to use metrics in compartment id ${var.compartment_ocid} where all {target.metrics.namespace = 'poolduck_staging_mail', request.permission = 'METRIC_WRITE'}"
  ]

  lifecycle {
    precondition {
      condition     = var.enable_email_instance_principal && var.enable_email_delivery_alerts
      error_message = "Application mail alerts require the existing instance principal and Notifications topic."
    }
  }
}

locals {
  email_application_alarm_queries = {
    delivery_unknown = "DeliveryUnknownNew[5m].max() > 0"
    auth_rejected    = "AuthRejectedNew[5m].max() > 0"
    quota_rejected   = "QuotaRejectedConsecutive[5m].max() >= 3"
    provider_failure = "ProviderFailureConsecutive[5m].max() >= 3"
    due_backlog      = "DueBacklogOldestMs[1m].max() > 5000"
    heartbeat_absent = "CollectorHeartbeat[1m].absent(5m)"
  }
}

resource "oci_monitoring_alarm" "staging_mail_application" {
  for_each              = var.enable_email_application_alerts ? local.email_application_alarm_queries : {}
  compartment_id        = var.compartment_ocid
  metric_compartment_id = var.compartment_ocid
  destinations          = [oci_ons_notification_topic.staging_mail[0].topic_id]
  display_name          = "${var.resource_prefix}-mail-app-${each.key}"
  namespace             = "poolduck_staging_mail"
  query                 = each.value
  severity              = "CRITICAL"
  is_enabled            = true
  resolution            = "1m"
  body                  = "Staging mail application stop signal. Keep real sending disabled or return to mock; inspect aggregate metrics and restricted logs. Never auto-retry delivery_unknown."

  depends_on = [oci_identity_policy.staging_mail_metrics]
}
