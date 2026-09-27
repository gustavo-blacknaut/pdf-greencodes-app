import { describe, expect, it } from 'vitest';
import { TOOLS } from '@/lib/tools';
import { ICONES } from './ToolIcon';

describe('ícones das ferramentas', () => {
  it('cada ferramenta tem o ícone específico registrado', () => {
    expect(TOOLS.filter((tool) => !ICONES[tool.icon]).map((tool) => tool.slug)).toEqual([]);
  });
});
