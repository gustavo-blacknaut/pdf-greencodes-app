# Verificação da versão 4.9.0

Esta versão mantém as alterações da 4.8.0 e acrescenta a revisão dos fluxos de preparação de documentos.

## Alterações

- Juntar PDF: escolha antes de finalizar entre não comprimir, compressão sem perda e recompressão de fotos a 600 DPI.
- Girar PDF: seleção individual, ângulos de 90°, 180° e 270°, prévia e indicação do giro acumulado. As páginas não selecionadas permanecem como estavam.
- Organizar PDF: arraste por ponteiro com miniatura flutuante, indicação do destino e rolagem automática pela borda visível da grade. Alt+setas move a página focada pelo teclado.
- Excel para PDF: leitura de XLS, XLSX e XLSM com SheetJS 0.20.3 da distribuição oficial. Macros não são executadas. Valores formatados são lidos; fórmulas usam o último resultado salvo pelo Excel. Textos longos não são cortados em 28 caracteres.
- Atalhos: Esc retorna ao início fora dos campos de edição; Ctrl+V recebe arquivos e imagens; Ctrl+O abre o seletor nas ferramentas. Digitação, colagem de texto e campos editáveis são respeitados.
- Duas ferramentas adicionais: padronizar orientação das páginas e gerar relatório CSV de medidas, orientação e rotação. O catálogo passou a 79 ferramentas.
- Dependências nanoid e Vitest atualizadas para corrigir os alertas identificados na auditoria.

## Evidências

| Verificação | Resultado |
| --- | --- |
| TypeScript e limite de tamanho dos módulos | Aprovados |
| Testes TypeScript | 791 aprovados |
| Testes Python | 313 aprovados |
| Testes Rust | 25 aprovados |
| Auditoria npm | Zero vulnerabilidades conhecidas informadas |
| Compilação de produção e instalador Windows | Concluídas |
| Arraste na interface | PDF sintético de 30 páginas; a página 1 foi movida para a terceira posição e o documento foi gerado |
| Rotação individual na interface | Apenas a página 2 selecionada, 180° aplicados e PDF gerado com indicação de uma página girada |
| Esc e Ctrl+O | Retorno ao início e abertura do seletor verificados |
| Ctrl+V | Imagem sintética recebida; texto colado normalmente no campo de nome sem inserir outro arquivo |
| Junção pela interface | Escolha de compressão sem perda aplicada e PDF gerado |
| XLS, XLSX e XLSM | Inspeção e conversão de arquivos sintéticos válidos, com duas abas, valores formatados e texto longo |

Os testes de montagem também verificam a ordem entre arquivos e rotações diferentes para cada página. Os registros completos estão na pasta local `provas`, que não integra a publicação.

## Limites

A conversão de Excel exporta o conteúdo das células, sem prometer reprodução de gráficos, imagens, mesclagens e layout de impressão do Excel. PDFs grandes e computadores com pouca memória continuam sujeitos aos limites de rasterização descritos na revisão 4.8.0. A impressão física e a calibração final de etiquetas dependem do equipamento de destino. HEIC não recebeu teste completo com uma amostra real nesta revisão.

A validação confirma os cenários acima e não representa garantia de ausência de defeitos em qualquer arquivo ou driver.

Fonte da dependência de leitura Excel: https://docs.sheetjs.com/docs/getting-started/installation/frameworks/
