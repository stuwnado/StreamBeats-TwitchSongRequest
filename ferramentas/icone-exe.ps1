# Troca o icone e as informacoes (nome, versao) de um .exe.
# Usa so funcoes que ja vem no Windows (kernel32: BeginUpdateResource / UpdateResource).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Ico,
  [Parameter(Mandatory = $true)][string]$Nome,
  [string]$Versao = '1.0.0'
)
$ErrorActionPreference = 'Stop'

if (-not ('StreamBeatsRes' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class StreamBeatsRes {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr BeginUpdateResource(string arquivo, bool apagarTudo);
  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "UpdateResourceW")]
  static extern bool UpdateResource(IntPtr h, IntPtr tipo, IntPtr nome, ushort lang, byte[] dados, uint tamanho);
  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "UpdateResourceW", CharSet = CharSet.Unicode)]
  static extern bool UpdateResourceNome(IntPtr h, IntPtr tipo, string nome, ushort lang, byte[] dados, uint tamanho);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool EndUpdateResource(IntPtr h, bool descartar);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string arquivo, IntPtr reservado, uint flags);
  [DllImport("kernel32.dll")]
  static extern bool FreeLibrary(IntPtr h);

  delegate bool ProcNome(IntPtr m, IntPtr tipo, IntPtr nome, IntPtr p);
  delegate bool ProcLang(IntPtr m, IntPtr tipo, IntPtr nome, ushort lang, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "EnumResourceNamesW")]
  static extern bool EnumResourceNames(IntPtr m, IntPtr tipo, ProcNome cb, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "EnumResourceLanguagesW")]
  static extern bool EnumResourceLanguages(IntPtr m, IntPtr tipo, IntPtr nome, ProcLang cb, IntPtr p);

  class Recurso { public int Tipo; public int Id; public string Nome; public ushort Lang; }

  static bool EhId(IntPtr p) { return ((long)p >> 16) == 0; }

  static List<Recurso> Listar(string exe, int tipo) {
    var lista = new List<Recurso>();
    IntPtr m = LoadLibraryEx(exe, IntPtr.Zero, 0x2); // LOAD_LIBRARY_AS_DATAFILE
    if (m == IntPtr.Zero) throw new Exception("Nao consegui abrir o .exe (erro " + Marshal.GetLastWin32Error() + ")");
    try {
      var nomes = new List<object>();
      EnumResourceNames(m, (IntPtr)tipo, (a, b, n, c) => {
        if (EhId(n)) nomes.Add((int)(long)n); else nomes.Add(Marshal.PtrToStringUni(n));
        return true;
      }, IntPtr.Zero);
      foreach (object nome in nomes) {
        IntPtr pNome = nome is int ? (IntPtr)(int)nome : Marshal.StringToHGlobalUni((string)nome);
        try {
          EnumResourceLanguages(m, (IntPtr)tipo, pNome, (a, b, n, lang, c) => {
            var r = new Recurso();
            r.Tipo = tipo; r.Lang = lang;
            if (nome is int) r.Id = (int)nome; else r.Nome = (string)nome;
            lista.Add(r);
            return true;
          }, IntPtr.Zero);
        } finally {
          if (!(nome is int)) Marshal.FreeHGlobal(pNome);
        }
      }
    } finally {
      FreeLibrary(m);
    }
    return lista;
  }

  static void Alinhar(BinaryWriter w) { while (w.BaseStream.Position % 4 != 0) w.Write((byte)0); }

  static byte[] Bloco(string chave, byte[] valor, ushort tamValor, ushort tipo, List<byte[]> filhos) {
    var ms = new MemoryStream();
    var w = new BinaryWriter(ms);
    w.Write((ushort)0); w.Write(tamValor); w.Write(tipo);
    w.Write(Encoding.Unicode.GetBytes(chave + "\0"));
    Alinhar(w);
    if (valor != null) w.Write(valor);
    if (filhos != null) foreach (byte[] f in filhos) { Alinhar(w); w.Write(f); }
    byte[] r = ms.ToArray();
    BitConverter.GetBytes((ushort)r.Length).CopyTo(r, 0);
    return r;
  }

  static byte[] Texto(string chave, string valor) {
    return Bloco(chave, Encoding.Unicode.GetBytes(valor + "\0"), (ushort)(valor.Length + 1), 1, null);
  }

  static byte[] InfoVersao(string nome, string versao) {
    string[] p = (versao + ".0.0.0").Split('.');
    uint a = uint.Parse(p[0]), b = uint.Parse(p[1]), c = uint.Parse(p[2]), d = uint.Parse(p[3]);
    var fixo = new MemoryStream();
    var w = new BinaryWriter(fixo);
    w.Write(0xFEEF04BDu); w.Write(0x00010000u);
    w.Write((a << 16) | b); w.Write((c << 16) | d); // versao do arquivo
    w.Write((a << 16) | b); w.Write((c << 16) | d); // versao do produto
    w.Write(0x3Fu); w.Write(0u); w.Write(0x40004u); w.Write(1u); w.Write(0u); w.Write(0u); w.Write(0u);
    string v = a + "." + b + "." + c;
    var textos = new List<byte[]> {
      Texto("CompanyName", "StreamBeats"),
      Texto("FileDescription", nome),
      Texto("FileVersion", v),
      Texto("InternalName", "StreamBeats"),
      Texto("OriginalFilename", nome + ".exe"),
      Texto("ProductName", nome),
      Texto("ProductVersion", v)
    };
    var tabela = Bloco("041604b0", null, 0, 1, textos); // portugues (Brasil), Unicode
    var sfi = Bloco("StringFileInfo", null, 0, 1, new List<byte[]> { tabela });
    var traducao = new byte[] { 0x16, 0x04, 0xB0, 0x04 };
    var vfi = Bloco("VarFileInfo", null, 0, 1, new List<byte[]> { Bloco("Translation", traducao, 4, 0, null) });
    return Bloco("VS_VERSION_INFO", fixo.ToArray(), 52, 0, new List<byte[]> { sfi, vfi });
  }

  public static void Aplicar(string exe, string ico, string nome, string versao) {
    byte[] icone = File.ReadAllBytes(ico);
    if (BitConverter.ToUInt16(icone, 0) != 0 || BitConverter.ToUInt16(icone, 2) != 1)
      throw new Exception("O arquivo de icone nao e um .ico valido");
    int qtd = BitConverter.ToUInt16(icone, 4);

    var antigos = new List<Recurso>();
    antigos.AddRange(Listar(exe, 14)); // grupos de icone
    antigos.AddRange(Listar(exe, 3));  // imagens de icone
    antigos.AddRange(Listar(exe, 16)); // informacoes de versao

    ushort lang = 1033;
    int grupoId = 1;
    foreach (var r in antigos) {
      if (r.Tipo == 14) { lang = r.Lang; if (r.Nome == null) grupoId = r.Id; break; }
    }

    IntPtr h = BeginUpdateResource(exe, false);
    if (h == IntPtr.Zero) throw new Exception("Nao consegui editar o .exe (erro " + Marshal.GetLastWin32Error() + ")");
    bool ok = false;
    try {
      foreach (var r in antigos) {
        bool apagou = r.Nome == null
          ? UpdateResource(h, (IntPtr)r.Tipo, (IntPtr)r.Id, r.Lang, null, 0)
          : UpdateResourceNome(h, (IntPtr)r.Tipo, r.Nome, r.Lang, null, 0);
        if (!apagou) throw new Exception("Nao consegui tirar o icone antigo (erro " + Marshal.GetLastWin32Error() + ")");
      }

      var grupo = new MemoryStream();
      var gw = new BinaryWriter(grupo);
      gw.Write((ushort)0); gw.Write((ushort)1); gw.Write((ushort)qtd);
      for (int i = 0; i < qtd; i++) {
        int e = 6 + 16 * i;
        int tamanho = BitConverter.ToInt32(icone, e + 8);
        int inicio = BitConverter.ToInt32(icone, e + 12);
        byte[] imagem = new byte[tamanho];
        Buffer.BlockCopy(icone, inicio, imagem, 0, tamanho);
        ushort id = (ushort)(i + 1);
        if (!UpdateResource(h, (IntPtr)3, (IntPtr)id, lang, imagem, (uint)imagem.Length))
          throw new Exception("Nao consegui gravar o icone (erro " + Marshal.GetLastWin32Error() + ")");
        gw.Write(icone, e, 12); // largura, altura, cores, reservado, planos, bits, tamanho
        gw.Write(id);
      }
      byte[] g = grupo.ToArray();
      if (!UpdateResource(h, (IntPtr)14, (IntPtr)grupoId, lang, g, (uint)g.Length))
        throw new Exception("Nao consegui gravar o grupo do icone (erro " + Marshal.GetLastWin32Error() + ")");

      byte[] info = InfoVersao(nome, versao);
      if (!UpdateResource(h, (IntPtr)16, (IntPtr)1, 0x0416, info, (uint)info.Length))
        throw new Exception("Nao consegui gravar o nome do programa (erro " + Marshal.GetLastWin32Error() + ")");
      ok = true;
    } finally {
      bool fechou = EndUpdateResource(h, !ok);
      if (ok && !fechou) throw new Exception("Nao consegui salvar o .exe (erro " + Marshal.GetLastWin32Error() + ")");
    }
  }
}
'@
}

[StreamBeatsRes]::Aplicar((Resolve-Path $Exe).Path, (Resolve-Path $Ico).Path, $Nome, $Versao)
