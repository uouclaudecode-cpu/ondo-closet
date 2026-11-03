// Supabase 프로젝트 정보 (Project Settings → API 에서 복사)
// anon(public) 키는 공개돼도 괜찮은 키예요. 데이터는 로그인한 본인만 읽고 쓸 수 있게 데이터베이스 규칙(RLS)으로 막혀 있어요.
// service_role 키는 절대 여기에 넣지 마세요.
window.ONDO_CONFIG = {
  supabaseUrl: "",      // 예: "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",  // 예: "eyJhbGciOi..."
};
