# Como contribuir

Obrigado por ajudar a manter os dados de municípios e estados brasileiros corretos e atualizados!

## Antes de começar

- Procure uma [issue](https://github.com/95wesley/municipios-brasileiros/issues) existente antes de abrir uma nova.
- Para mudanças grandes, abra uma issue primeiro para combinar a proposta.

## Fluxo de contribuição

1. Faça um fork do repositório e crie uma branch com um nome descritivo, por exemplo `fix/nome-municipio` ou `docs/readme`.
2. Edite **apenas os arquivos em `csv/`** quando a mudança for nos dados. `json/` e `sql/` são gerados a partir do CSV.
3. Regenere os arquivos derivados:

   ```bash
   python scripts/build.py
   ```

4. Valide os dados. O comando precisa terminar com `OK`:

   ```bash
   python scripts/validate_files.py
   ```

5. Abra um pull request explicando o que mudou e de onde veio a informação (por exemplo, o link oficial do IBGE).

## Padrões

- Mantenha os arquivos em UTF-8, sem BOM, com quebras de linha LF.
- Use o código IBGE como identificador. Nomes de municípios se repetem entre estados.
- Não edite manualmente `json/` nem `sql/`: as alterações seriam sobrescritas pelo `build.py`.
- Para mudanças no explorador web (`web/`), teste no navegador com um servidor local: `python -m http.server`.

## Dúvidas

Abra uma [issue](https://github.com/95wesley/municipios-brasileiros/issues) com a sua pergunta.
