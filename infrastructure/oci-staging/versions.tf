# Terraform CLI 与 OCI Provider 版本锁定，避免人工实施时因 Provider 破坏性变更导致计划漂移。
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    oci = {
      source = "oracle/oci"
      # 8.19.0 fixes UpdateInstance sending localVolumeSizeInGBs=0 on A1 Flex.
      version = "= 8.19.0"
    }
  }
}

# OCI Provider 使用变量传入区域；认证推荐由人工在实施机器配置 OCI CLI profile 或环境变量，仓库不保存密钥。
provider "oci" {
  region = var.region
}
