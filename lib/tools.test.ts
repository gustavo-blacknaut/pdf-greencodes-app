import { describe, expect, it } from 'vitest';
import { CATEGORIES, defaultOptions, ferramentasDaEdicao, FERRAMENTAS_COMPLETAS, getTool, isFieldVisible, TOOLS } from './tools';

describe('edições do aplicativo', () => {
  it('OPUS oferece as ferramentas principais e exclui as dispensadas', () => {
    const slugs = ferramentasDaEdicao(true).map((tool) => tool.slug);
    expect(slugs).toContain('imprimir');
    expect(slugs).toContain('organizar-paginas');
    expect(slugs).toContain('informacoes-pdf');
    for (const slug of FERRAMENTAS_COMPLETAS) expect(slugs).not.toContain(slug);
  });

  it('a edição completa mantém as ferramentas dispensadas no final', () => {
    const slugs = ferramentasDaEdicao(false).map((tool) => tool.slug);
    const primeiroExtra = slugs.findIndex((slug) => FERRAMENTAS_COMPLETAS.has(slug));
    expect(primeiroExtra).toBeGreaterThan(0);
    expect(slugs.slice(primeiroExtra).every((slug) => FERRAMENTAS_COMPLETAS.has(slug))).toBe(true);
    for (const slug of FERRAMENTAS_COMPLETAS) expect(slugs).toContain(slug);
  });

  it('remove as funções permanentes e reúne as três conferências nas duas edições', () => {
    for (const opus of [false, true]) {
      const tools = ferramentasDaEdicao(opus);
      for (const slug of ['separar-chapas', 'separar-pares-impares', 'verificar-impressao', 'relatorio-paginas', 'cobertura-de-tinta']) {
        expect(tools.some((tool) => tool.slug === slug)).toBe(false);
      }
      expect(tools.filter((tool) => tool.operation === 'pdf-information')).toHaveLength(1);
    }
  });
});

describe('registro de ferramentas', () => {
  it('não tem slug repetido, senão duas rotas colidiriam', () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('não tem chave de campo repetida dentro da mesma ferramenta', () => {
    for (const tool of TOOLS) {
      const chaves = tool.fields.map((f) => f.key);
      expect(new Set(chaves).size, `${tool.slug} tem campos duplicados`).toBe(chaves.length);
    }
  });

  it('usa apenas categorias declaradas, para nenhuma ferramenta sumir do rodapé', () => {
    for (const tool of TOOLS) {
      expect(CATEGORIES).toContain(tool.category);
    }
  });

  it('preenche os campos obrigatórios de cada ferramenta', () => {
    for (const tool of TOOLS) {
      expect(tool.name, tool.slug).toBeTruthy();
      expect(tool.cta, tool.slug).toBeTruthy();
      // Ferramenta sem arquivo tira a entrada dos campos, então não declara
      // o que aceita — mas aí precisa ter campo, senão não recebe nada.
      if (tool.semArquivo) expect(tool.fields.length, tool.slug).toBeGreaterThan(0);
      else expect(tool.accept.length, tool.slug).toBeGreaterThan(0);
    }
  });

  it('ferramenta sem arquivo não pede vários nem grade de páginas', () => {
    for (const tool of TOOLS.filter((t) => t.semArquivo)) {
      expect(tool.multiple, `${tool.slug} não recebe arquivo, então não recebe vários`).toBe(false);
      expect(tool.board, tool.slug).toBeUndefined();
      expect(tool.editor, tool.slug).toBeUndefined();
    }
  });

  it('só aceita vários arquivos quando a operação sabe lidar com isso', () => {
    for (const tool of TOOLS) {
      if (tool.orderable) expect(tool.multiple, `${tool.slug} ordena mas não aceita vários`).toBe(true);
    }
  });

  it('não mistura grade de páginas com campos de formulário', () => {
    for (const tool of TOOLS) {
      if (tool.board) expect(tool.fields, `${tool.slug} tem grade e campos`).toHaveLength(0);
    }
  });

  it('nenhuma ferramenta usa grade e editor ao mesmo tempo', () => {
    for (const tool of TOOLS) {
      expect(Boolean(tool.board && tool.editor), `${tool.slug} usa as duas telas`).toBe(false);
    }
  });

  it('o editor trabalha com um arquivo só, porque a tela mostra um documento', () => {
    for (const tool of TOOLS) {
      if (tool.editor) expect(tool.multiple, `${tool.slug} abre editor com vários arquivos`).toBe(false);
    }
  });

  it('aponta showIf apenas para campos que existem na mesma ferramenta', () => {
    for (const tool of TOOLS) {
      const chaves = new Set(tool.fields.map((f) => f.key));
      for (const campo of tool.fields) {
        if (campo.showIf) {
          expect(chaves.has(campo.showIf.key), `${tool.slug}.${campo.key} aponta para campo inexistente`).toBe(true);
        }
      }
    }
  });
});

describe('getTool', () => {
  it('encontra pelo slug', () => {
    expect(getTool('comprimir-pdf')?.name).toBe('Comprimir PDF');
  });

  it('devolve undefined para slug desconhecido, o que vira 404', () => {
    expect(getTool('nao-existe')).toBeUndefined();
  });
});

describe('defaultOptions', () => {
  it('entrega um valor inicial para cada campo', () => {
    for (const tool of TOOLS) {
      const valores = defaultOptions(tool);
      for (const campo of tool.fields) {
        expect(valores[campo.key], `${tool.slug}.${campo.key}`).toBeDefined();
      }
    }
  });

  it('prepara a lista de elementos e o modo nas ferramentas de editor', () => {
    const editores = TOOLS.filter((t) => t.editor);
    expect(editores.length).toBeGreaterThan(0);
    for (const tool of editores) {
      const valores = defaultOptions(tool);
      expect(valores.elementos).toBe('[]');
      expect(valores.editor).toBe(tool.editor);
    }
  });

  it('prepara plano e modo nas ferramentas de grade', () => {
    const grade = TOOLS.filter((t) => t.board);
    expect(grade.length).toBeGreaterThan(0);
    for (const tool of grade) {
      const valores = defaultOptions(tool);
      expect(valores.plan).toBe('[]');
      expect(valores.board).toBe(tool.board);
    }
  });

  it('o valor inicial de um select é sempre uma das opções', () => {
    for (const tool of TOOLS) {
      for (const campo of tool.fields) {
        if (campo.type === 'select') {
          const valores = campo.options.map((o) => o.value);
          expect(valores, `${tool.slug}.${campo.key}`).toContain(campo.default);
        }
      }
    }
  });

  it('o valor inicial de um range respeita os limites', () => {
    for (const tool of TOOLS) {
      for (const campo of tool.fields) {
        if (campo.type === 'range' || campo.type === 'number') {
          expect(campo.default, `${tool.slug}.${campo.key}`).toBeGreaterThanOrEqual(campo.min);
          expect(campo.default, `${tool.slug}.${campo.key}`).toBeLessThanOrEqual(campo.max);
        }
      }
    }
  });
});

describe('isFieldVisible', () => {
  const dividir = getTool('dividir-pdf')!;
  const intervalos = dividir.fields.find((f) => f.key === 'ranges')!;
  const aCada = dividir.fields.find((f) => f.key === 'every')!;

  it('esconde o campo quando a condição não bate', () => {
    expect(isFieldVisible(intervalos, { mode: 'every' })).toBe(false);
    expect(isFieldVisible(aCada, { mode: 'every' })).toBe(true);
  });

  it('mostra o campo quando a condição bate', () => {
    expect(isFieldVisible(intervalos, { mode: 'ranges' })).toBe(true);
    expect(isFieldVisible(aCada, { mode: 'ranges' })).toBe(false);
  });

  it('sempre mostra campo sem condição', () => {
    expect(isFieldVisible(dividir.fields[0], {})).toBe(true);
  });
});
