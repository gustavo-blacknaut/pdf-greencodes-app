import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Juntar e comprimir, as duas etapas no mesmo motor.
 *
 * Antes, o resultado do juntar subia para a tela e voltava para o motor só
 * para ser comprimido: 170 MB atravessando duas vezes, 7,7 s e o dobro de
 * memória para o arquivo mudar de mãos entre duas etapas. Agora a segunda abre
 * o arquivo que a primeira acabou de gravar, na pasta de trabalho do motor.
 */

const motorFalso = {
  executar: vi.fn(),
  cancelar: vi.fn(),
  pastaTemporaria: vi.fn(),
  gravarEntrada: vi.fn(),
  vincularEntrada: vi.fn(),
  lerSaida: vi.fn(),
  limpar: vi.fn(),
  aoAndar: vi.fn(),
  entregar: vi.fn(),
};

vi.mock('../desktop', () => ({
  motorPython: () => motorFalso,
}));

const { rodarNoPython } = await import('./motor-python');

const arquivo = (id: string, nome: string, size: number, senha?: string) => ({
  id,
  name: nome,
  size,
  type: 'application/pdf',
  bytes: new ArrayBuffer(8),
  pageCount: 1,
  thumbnail: null,
  ...(senha ? { senha } : {}),
});

function contexto(opcoes: Record<string, string> = { compressaoApos: 'alta' }) {
  return {
    files: [arquivo('1', 'a.pdf', 100, 'abc'), arquivo('2', 'b.pdf', 200)],
    options: opcoes,
    onProgress: () => {},
  } as unknown as Parameters<typeof rodarNoPython>[1];
}

const UNIDO = 'C:\\temp\\x\\a-unido.pdf';
const COMPRIMIDO = 'C:\\temp\\x\\a-unido-comprimido.pdf';

beforeEach(() => {
  motorFalso.pastaTemporaria.mockResolvedValue('C:\\temp\\x');
  motorFalso.gravarEntrada.mockImplementation(async (_pasta: string, nome: string) => `C:\\temp\\x\\${nome}`);
  motorFalso.limpar.mockResolvedValue(undefined);
  // O `cancelar` de verdade é uma chamada ao Rust: devolve promessa.
  motorFalso.cancelar.mockResolvedValue(true);
  motorFalso.aoAndar.mockReturnValue(() => {});
  motorFalso.lerSaida.mockResolvedValue({ nome: 'a-unido-comprimido.pdf', bytes: new ArrayBuffer(50) });
  motorFalso.executar
    .mockResolvedValueOnce({ arquivo: UNIDO, paginas: 3, notas: ['juntou'] })
    .mockResolvedValueOnce({ arquivo: COMPRIMIDO, paginas: 3, notas: ['comprimiu'] });
});

afterEach(() => {
  vi.clearAllMocks();
  motorFalso.executar.mockReset();
});

describe('juntar e comprimir no mesmo motor', () => {
  it('a segunda etapa abre o arquivo que a primeira gravou, sem passar pela tela', async () => {
    await rodarNoPython('merge', contexto());

    expect(motorFalso.executar).toHaveBeenCalledTimes(2);
    expect(motorFalso.executar.mock.calls[0][0]).toBe('juntar');
    expect(motorFalso.executar.mock.calls[1][0]).toBe('comprimir');
    expect(motorFalso.executar.mock.calls[1][1].arquivos).toEqual([UNIDO]);
    // O resultado da primeira etapa nunca foi lido de volta: era o que custava 7,7 s.
    expect(motorFalso.lerSaida).toHaveBeenCalledTimes(1);
    expect(motorFalso.lerSaida).toHaveBeenCalledWith(COMPRIMIDO);
    // E nada foi regravado na pasta: só a entrada de cada um dos dois PDFs.
    expect(motorFalso.gravarEntrada).toHaveBeenCalledTimes(2);
  });

  it('comprime com as opções do nível escolhido e a senha do primeiro arquivo', async () => {
    await rodarNoPython('merge', contexto());

    const pedido = motorFalso.executar.mock.calls[1][1];
    expect(pedido.opcoes).toEqual({ modo: 'imagens', dpi: 600, qualidade: 88 });
    // A do primeiro é a que o juntar põe no resultado.
    expect(pedido.senhas).toEqual(['abc']);
  });

  it('sem perda pede a compressão que não toca em imagem nenhuma', async () => {
    await rodarNoPython('merge', contexto({ compressaoApos: 'sem-perda' }));
    expect(motorFalso.executar.mock.calls[1][1].opcoes).toEqual({ redesenhar: false });
  });

  it('sem escolher compressão, roda só o juntar', async () => {
    motorFalso.executar.mockReset();
    motorFalso.executar.mockResolvedValue({ arquivo: UNIDO, paginas: 3, notas: [] });

    const resultado = await rodarNoPython('merge', contexto({ compressaoApos: 'nao' }));

    expect(motorFalso.executar).toHaveBeenCalledTimes(1);
    expect(resultado.jaComprimido).toBe(false);
  });

  it('junta as notas das duas etapas, avisa que já comprimiu e mostra a economia', async () => {
    const resultado = await rodarNoPython('merge', contexto());

    expect(resultado.notes).toEqual(['juntou', 'comprimiu', 'Compressão após a junção aplicada conforme sua escolha.']);
    expect(resultado.jaComprimido).toBe(true);
    expect(resultado.highlightSavings).toBe(true);
    // O "antes" é o das entradas, e não o do arquivo intermediário.
    expect(resultado.inputBytes).toBe(300);
    expect(resultado.files[0].pages).toBe(3);
  });

  it('a barra anda para frente nas duas etapas, sem voltar a 2%', async () => {
    const barra: number[] = [];
    let aoAndar: (p: { fracao: number; mensagem?: string }) => void = () => {};
    motorFalso.aoAndar.mockImplementation((cb: typeof aoAndar) => {
      aoAndar = cb;
      return () => {};
    });
    motorFalso.executar.mockReset();
    motorFalso.executar
      .mockImplementationOnce(async () => {
        aoAndar({ fracao: 0.5, mensagem: 'Arquivo 1 de 2' });
        aoAndar({ fracao: 1 });
        return { arquivo: UNIDO, notas: [] };
      })
      .mockImplementationOnce(async () => {
        aoAndar({ fracao: 0.2, mensagem: 'Reduzindo as imagens' });
        aoAndar({ fracao: 1 });
        return { arquivo: COMPRIMIDO, notas: [] };
      });

    await rodarNoPython('merge', { ...contexto(), onProgress: (f: number) => void barra.push(f) });

    for (let i = 1; i < barra.length; i += 1) {
      expect(barra[i], `passo ${i}: ${barra.join(', ')}`).toBeGreaterThanOrEqual(barra[i - 1]);
    }
    expect(barra.at(-1)).toBe(1);
  });

  it('cancelar entre as duas etapas não deixa a segunda começar', async () => {
    const controle = new AbortController();
    motorFalso.executar.mockReset();
    motorFalso.executar.mockImplementationOnce(async () => {
      controle.abort();
      return { arquivo: UNIDO, notas: [] };
    });

    await expect(rodarNoPython('merge', { ...contexto(), signal: controle.signal })).rejects.toBeTruthy();
    expect(motorFalso.executar).toHaveBeenCalledTimes(1);
  });
});
