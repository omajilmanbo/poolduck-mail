# Infrastructure

本目录存放 Poolduck Mail 的基础设施即代码（IaC）。当前仅包含 Issue #48 的 OCI Always Free Staging 资源准备代码：

- `oci-staging/`：面向已存在 OCI compartment `Mail_project_stg` 的 Terraform 配置。

所有 IaC 文件只允许保存非敏感参数、占位值与资源定义；真实密钥、token、数据库密码、OAuth refresh token、客户数据不得提交到仓库。
