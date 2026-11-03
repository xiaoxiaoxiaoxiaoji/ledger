// ============================================================
//  记账应用配置文件
//  想要「手机和电脑同一份账本」时，在这里填入你自己的 Supabase 信息
//  不填也能用：应用会自动降级为「仅保存在本机浏览器」的本地模式
//  详细图文步骤见 README.md
// ============================================================

window.APP_CONFIG = {
  // ① Supabase 项目地址，形如 https://xxxxxxxx.supabase.co
  supabaseUrl: "https://avpbhlhcximataflhrfb.supabase.co",

  // ② Supabase 的 anon public key（在项目 Settings → API 里，名为 "anon public" 的那一长串）
  supabaseKey: "sb_publishable_2vfWaJgspDplEyrIThpgSg_c_XhTR2d",

  // Supabase JS SDK 加载地址（一般不用改）
  supabaseSdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"
};
