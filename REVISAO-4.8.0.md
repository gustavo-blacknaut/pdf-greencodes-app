# Revisão local 4.8.0

Verificação realizada em 17/09/2026. Nenhuma alteração foi publicada no GitHub.

## Correções e ferramentas

- Impressão com padrão de 600 DPI, inclusive quando existiam configurações antigas salvas. Removido o limite intermediário de 4200 pixels que reduzia a resolução de uma A4 antes de ampliá-la novamente.
- Duas páginas por folha A4 em paisagem, com duas áreas de meia folha, proporção preservada e rotação automática. Páginas vazias são aceitas e margens impossíveis geram uma mensagem clara.
- Etiquetas com várias artes e quantidade individual, margem interna esquerda de 2 mm e ajustes de altura e por coluna. A grade Pimaco 6093 mantém as medidas informadas.
- Nova ferramenta **Calibrar impressão**, com grade de etiquetas, réguas de 100 mm e quadrado de 50 mm.
- Nova ferramenta **Separar por tamanho de papel**, preservando conteúdo e rotação das páginas.
- Corrigidos transferência do resultado para impressão, gravações duplicadas, arquivos com nomes iguais, cancelamento e liberação de documentos/canvases após erros.
- Lotes preparados um por vez e nitidez com memória auxiliar menor, mantendo os mesmos pixels do algoritmo anterior.
- Corrigida a configuração do servidor que impedia o OCR de executar WebAssembly. Compressão HTTP com menor custo de CPU, sem mudar o conteúdo.
- Removida a opção de abrir PDF dentro do aplicativo.

## Verificações concluídas

| Verificação | Resultado |
| --- | --- |
| TypeScript e limite de tamanho dos arquivos | Aprovados |
| Testes TypeScript | 774 aprovados |
| Testes Rust | 25 aprovados |
| Testes Python | 313 aprovados |
| Prova no navegador de produção | 71 ferramentas geraram arquivos, incluindo OCR e as duas novas ferramentas |
| Funções exclusivas do motor | Folha de fotos, separação de chapas, cobertura de tinta e CMYK geraram resultados nas provas locais |
| Microsoft Print to PDF | A4 retrato/paisagem, A5, A3 e Carta com tamanho de folha e cobertura aprovados |
| Interface de calibração | Geração de duas páginas da Pimaco 6093 concluída pela interface |

Os registros estão em `provas/verificacao-4.8.0.log`, `provas/motor-4.8.0.log`, `provas/provas-4.8.0.log` e `provas/build-4.8.0.log`. As provas usam somente arquivos sintéticos. O relatório automático de terminal tem cobertura menor porque não executa os recursos de canvas do navegador; ele é complementado pela prova de produção acima.

## Limites da verificação

- Não houve impressão física na impressora do usuário. O deslocamento final das etiquetas deve ser medido com a folha de calibração antes da produção.
- HEIC não teve teste completo nesta revisão, por falta de uma amostra desse formato.
- O padrão é 600 DPI, mas os limites de memória já existentes ainda podem reduzir a resolução em papéis grandes ou dispositivos com pouca memória. Não foi realizado benchmark em um computador fraco real.
- As provas confirmam os cenários descritos; não garantem ausência de erros em qualquer PDF ou driver de impressora.
