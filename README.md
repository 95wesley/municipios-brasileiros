# Municípios Brasileiros

[![Validar dados](https://github.com/95wesley/municipios-brasileiros/actions/workflows/validate.yml/badge.svg)](https://github.com/95wesley/municipios-brasileiros/actions/workflows/validate.yml)
[![Versão](https://img.shields.io/badge/vers%C3%A3o-2.0.0-blue)](CHANGELOG.md)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-green)](LICENSE)

Arquivos `SQL`, `CSV` e `JSON` com os **5.570 municípios** e as **27 UFs** do Brasil, incluindo código IBGE, nome, capital, código UF, código SIAFI, DDD, fuso horário e **latitude/longitude**.

Além dos dados, o repositório traz:

- um **globo 3D** e um **mapa 2D** no navegador, com busca e geolocalização;
- um **servidor MCP** para consultar os dados a partir de assistentes de IA;
- scripts de **validação** e **geração** dos arquivos derivados.

## Sumário

- [Conteúdo do repositório](#conteúdo-do-repositório)
- [Campos](#campos)
- [Exemplos](#exemplos)
- [Uso rápido](#uso-rápido)
- [Explorador web: globo 3D e mapa 2D](#explorador-web-globo-3d-e-mapa-2d)
- [Servidor MCP](#servidor-mcp)
- [Qualidade dos dados](#qualidade-dos-dados)
- [Exportação dos dados](#exportação-dos-dados)
- [Contribuição](#contribuição)
- [Créditos](#créditos)
- [Licença](#licença)

## Conteúdo do repositório

```
csv/          municipios.csv e estados.csv (fonte única dos dados)
json/         municipios.json e estados.json (gerados a partir do CSV)
sql/          municipios.sql e estados.sql (gerados a partir do CSV)
scripts/      build.py (gera os arquivos) e validate_files.py (valida os dados)
            lib/municipios.py (funções compartilhadas)
mcp/          servidor MCP (server.py e requirements.txt)
web/          explorador web: globo 3D, mapa 2D e geolocalização
```

> O CSV é a **fonte única**. Os arquivos `json/` e `sql/` são gerados por `scripts/build.py` e não devem ser editados à mão.

## Campos

### Municípios (`municipios`)

| Campo          | Tipo    | Descrição                                                            |
| -------------- | ------- | -------------------------------------------------------------------- |
| `codigo_ibge`  | inteiro | Código IBGE do município (7 dígitos). Chave primária.                |
| `nome`         | texto   | Nome do município.                                                   |
| `latitude`     | decimal | Latitude em graus decimais.                                          |
| `longitude`    | decimal | Longitude em graus decimais.                                         |
| `capital`      | 0 ou 1  | `1` se for capital da UF, `0` caso contrário (`BOOLEAN` no SQL).     |
| `codigo_uf`    | inteiro | Código IBGE da UF. Chave estrangeira para `estados`.                 |
| `siafi_id`     | texto   | Código SIAFI com 4 dígitos. **Mantém zeros à esquerda** (ex.: `"0401"`). |
| `ddd`          | inteiro | Código DDD.                                                          |
| `fuso_horario` | texto   | Fuso horário IANA (ex.: `America/Sao_Paulo`).                        |

### Estados (`estados`)

| Campo       | Tipo    | Descrição                                            |
| ----------- | ------- | ---------------------------------------------------- |
| `codigo_uf` | inteiro | Código IBGE da UF. Chave primária.                   |
| `uf`        | texto   | Sigla da UF (ex.: `GO`).                             |
| `nome`      | texto   | Nome da UF.                                          |
| `latitude`  | decimal | Coordenada de referência da UF.                      |
| `longitude` | decimal | Coordenada de referência da UF.                      |
| `regiao`    | texto   | Grande região (`Norte`, `Nordeste`, `Sudeste`, `Sul`, `Centro-Oeste`). |

Para obter a região de um município, faça a junção com `estados` pelo `codigo_uf`.

## Exemplos

### Municípios (CSV)

```csv
codigo_ibge,nome,latitude,longitude,capital,codigo_uf,siafi_id,ddd,fuso_horario
5200050,Abadia de Goiás,-16.7573,-49.4412,0,52,1050,62,America/Sao_Paulo
2704302,Maceió,-9.66599,-35.735,1,27,2785,82,America/Sao_Paulo
5106752,Pontes e Lacerda,-15.2219,-59.3435,0,51,8999,65,America/Porto_Velho
4314902,Porto Alegre,-30.0318,-51.2065,1,43,8801,51,America/Sao_Paulo
```

### Municípios (JSON)

```json
[
    {
        "codigo_ibge": 2704302,
        "nome": "Maceió",
        "latitude": -9.66599,
        "longitude": -35.735,
        "capital": 1,
        "codigo_uf": 27,
        "siafi_id": "2785",
        "ddd": 82,
        "fuso_horario": "America/Sao_Paulo"
    }
]
```

### Municípios (SQL)

```sql
CREATE TABLE municipios(
    codigo_ibge INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    latitude FLOAT(8) NOT NULL,
    longitude FLOAT(8) NOT NULL,
    capital BOOLEAN NOT NULL,
    codigo_uf INT NOT NULL,
    siafi_id VARCHAR(4) NOT NULL UNIQUE,
    ddd INT NOT NULL,
    fuso_horario VARCHAR(32) NOT NULL,
    PRIMARY KEY (codigo_ibge),
    FOREIGN KEY (codigo_uf) REFERENCES estados (codigo_uf)
);

INSERT INTO municipios VALUES
(2704302,'Maceió',-9.66599,-35.735,TRUE,27,'2785',82,'America/Sao_Paulo'),
...;
```

A tabela `estados` segue o mesmo padrão e está em [`sql/estados.sql`](sql/estados.sql).

## Uso rápido

Requisitos: **Python 3.9+** para os scripts (somente biblioteca padrão).

```bash
# Validar os dados e verificar se json/ e sql/ estão atualizados
python scripts/validate_files.py

# Regenerar json/ e sql/ a partir do CSV (depois de editar csv/)
python scripts/build.py
```

O `validate_files.py` roda automaticamente no GitHub Actions a cada push e pull request.

## Explorador web: globo 3D e mapa 2D

A pasta [`web/`](web/) tem um explorador estático, sem etapa de build:

- **Globo 3D** com os 5.570 municípios, coloridos por fuso horário e com as capitais destacadas;
- **Mapa 2D** com tiles do [OpenStreetMap](https://www.openstreetmap.org/copyright);
- **Busca** por nome (sem acento e sem diferenciar maiúsculas);
- **Filtro por UF**;
- **Minha localização**: usa a geolocalização do navegador e encontra o município mais próximo.

Como o navegador bloqueia `fetch` em arquivos abertos direto do disco, sirva a pasta do repositório:

```bash
python -m http.server 8000
# abra http://localhost:8000/web/
```

Ou acesse a versão publicada no GitHub Pages: https://95wesley.github.io/municipios-brasileiros/web/

**Privacidade:** a geolocalização é calculada **no seu navegador**, sobre os dados do repositório. Nenhuma coordenada é enviada a servidores. A permissão de localização é pedida apenas quando você clica em "Minha localização".

## Servidor MCP

O diretório [`mcp/`](mcp/) contém um servidor [MCP](https://modelcontextprotocol.io) que permite consultar os dados a partir de assistentes como o Claude.

Requisitos: **Python 3.10+** (o SDK `mcp` exige essa versão).

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r mcp/requirements.txt
```

Registrar no Claude Code (use o caminho absoluto do arquivo):

```bash
claude mcp add municipios -- python /caminho/absoluto/para/municipios-brasileiros/mcp/server.py
```

Ferramentas disponíveis:

| Ferramenta                       | O que faz                                                              |
| -------------------------------- | ---------------------------------------------------------------------- |
| `search_municipio`               | Busca por nome (sem acento), com filtro opcional por UF.               |
| `get_municipio`                  | Retorna um município pelo código IBGE.                                 |
| `list_municipios_by_uf`          | Lista os municípios de uma UF, em ordem alfabética.                    |
| `get_estado`                     | Retorna uma UF com a contagem de municípios.                           |
| `list_capitals`                  | Lista as 27 capitais.                                                  |
| `nearest_municipios`             | Municípios dentro de um raio (km) de uma coordenada.                   |
| `nearest_municipio`              | Município mais próximo de uma coordenada.                              |
| `dataset_statistics`             | Totais por região, fuso horário e UF.                                  |
| `validate_dataset`               | Executa as validações de qualidade dos dados.                          |

Recurso disponível: `municipios://estados` (as 27 UFs em JSON).

## Qualidade dos dados

O `validate_files.py` verifica:

- contagens: 5.570 municípios e 27 UFs;
- campos vazios e cabeçalhos corretos;
- unicidade de `codigo_ibge` e `siafi_id`;
- chave estrangeira `codigo_uf` e prefixo do código IBGE (os dois primeiros dígitos são o código da UF);
- exatamente uma capital por UF;
- formato do SIAFI (4 dígitos) e do DDD;
- coordenadas dentro do território brasileiro;
- nomes duplicados dentro da mesma UF;
- que `json/` e `sql/` correspondem exatamente ao CSV.

Pontos de atenção conhecidos (não são erros):

- **Nomes repetem entre UFs** (ex.: `Alvorada`, `Amparo`). Use sempre `codigo_ibge` como identificador.
- **Precisão das coordenadas varia** (4 a 6 casas decimais). As coordenadas não foram conferidas uma a uma contra uma fonte oficial de geometria.
- **Municípios a mais de 1.500 km do ponto de referência da UF** são listados como avisos. Em estados grandes, como o Amazonas, isso pode ser normal.

## Exportação dos dados

Existem diversas ferramentas para trabalhar com bancos de dados e exportar os dados em outros formatos. Uma ferramenta que costumo utilizar com frequência é o [DBeaver](https://dbeaver.io/), pois além de ser multiplataforma ela é simples de usar e disponibiliza várias opções para a exportação dos dados.

## Serviço de Dados do IBGE

O IBGE disponibiliza diversas informações sobre as localidades do Brasil pela API de Localidades: https://servicodados.ibge.gov.br/api/docs/localidades

## Contribuição

Encontrou um dado inconsistente ou tem alguma sugestão? Abra uma [issue](https://github.com/95wesley/municipios-brasileiros/issues) ou envie um [pull request](https://github.com/95wesley/municipios-brasileiros/pulls).

Antes de enviar uma alteração:

1. edite apenas os arquivos em `csv/`;
2. rode `python scripts/build.py` para atualizar `json/` e `sql/`;
3. rode `python scripts/validate_files.py` e confirme que termina com `OK`.

Veja também o [CHANGELOG](CHANGELOG.md).

## Créditos

- Dados de municípios e UFs: [IBGE](https://www.ibge.gov.br/) e [SIAFI](https://www.gov.br/tesouronacional/pt-br/siafi).
- Mapa base: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Globo 3D: [globe.gl](https://globe.gl/) (three.js) e textura da Terra de [three-globe](https://github.com/vasturiano/three-globe).
- Mapa 2D: [Leaflet](https://leafletjs.com/).

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
