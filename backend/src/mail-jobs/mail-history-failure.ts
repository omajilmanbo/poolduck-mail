export function mailHistoryFailureMessage({ errorMessage, status, scheduledAt }: {
  errorMessage: string | null;
  status: string;
  scheduledAt: Date | null;
}): string | null {
  switch (errorMessage) {
    case 'OCI_QUOTA_REJECTED': {
      const reason = '邮件服务因配额或频率限制拒绝了本次发送';
      if (status === 'queued' && scheduledAt) return `${reason}，等待自动重试`;
      if (status === 'failed') return `${reason}，本次任务已停止重试`;
      return reason;
    }
    case 'OCI_AUTH_REJECTED':
      return '系统未通过邮件服务的发信认证，本次任务不会自动重试';
    case 'RECIPIENT_SUPPRESSED':
      return '邮件服务已停止向该收件地址投递，本次任务不会自动重试';
    default:
      return safeMailFailureMessage(errorMessage);
  }
}

export function safeMailFailureMessage(message: string | null): string | null {
  if (!message) return null;
  return message === 'Sandbox provider simulated failure' ? message : '邮件发送失败';
}
