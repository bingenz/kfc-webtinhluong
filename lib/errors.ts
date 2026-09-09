export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (text.includes('email not confirmed')) return 'Hãy xác nhận email trước khi đăng nhập.';
  if (text.includes('already registered')) return 'Email đã được đăng ký. Hãy đăng nhập hoặc đặt lại mật khẩu.';
  if (text.includes('rate limit') || text.includes('too many requests')) return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
  if (text.includes('password') && (text.includes('least') || text.includes('weak'))) return 'Mật khẩu chưa đủ mạnh. Hãy dùng ít nhất 8 ký tự, gồm chữ và số.';
  if (text.includes('same_password')) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (text.includes('duplicate key')) return 'Tên đăng nhập này đã được sử dụng. Hãy chọn tên khác.';
  if (text.includes('failed to fetch') || text.includes('network') || text.includes('fetch failed')) return 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.';
  if (text.includes('jwt') || text.includes('refresh token')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (text.includes('row-level security') || text.includes('permission denied')) return 'Bạn không có quyền thực hiện thao tác này.';
  if (text.includes('revision_conflict')) return 'Sổ đã thay đổi trên thiết bị khác. Tải lại trang trước khi lưu tiếp.';
  if (text.includes('invalid_document')) return 'Dữ liệu không hợp lệ hoặc vượt dung lượng cho phép.';
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(message)) return message;
  return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}
