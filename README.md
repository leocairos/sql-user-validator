# Validador de Acessos MS SQL 🛡️

Este projeto é um script em Node.js criado para automatizar a validação de múltiplos logins em um banco de dados MS SQL Server. Ele conecta com cada credencial fornecida e verifica, em tempo real, quais tabelas e views o usuário tem permissão de leitura (`SELECT`), exportando o resultado final para um arquivo CSV.

A principal vantagem desta abordagem é que **não exige permissões de `sysadmin`**. O script atua sob o contexto de cada usuário, garantindo um teste de acesso real (end-to-end).

## 📋 Pré-requisitos

* [Node.js](https://nodejs.org/) instalado (versão 14 ou superior recomendada).
* Acesso de rede ao servidor MS SQL alvo.

## 🚀 Instalação

1. Clone o repositório ou crie uma pasta para o projeto.
2. Inicie o projeto Node e instale as dependências necessárias (`mssql` e `dotenv`):

\`\`\`bash
npm init -y
npm install mssql dotenv
\`\`\`

## ⚙️ Configuração

Por questões de segurança, as credenciais de banco de dados e os logins dos usuários **não devem ficar no código-fonte**. Siga os passos abaixo para configurar os arquivos locais:

### 1. Configuração do Servidor (`.env`)
Crie um arquivo chamado `.env` na raiz do projeto e adicione os parâmetros de conexão do servidor alvo:

\`\`\`env
DB_SERVER=
DB_PORT=
DB_NAME=
DB_READ_ONLY_INTENT=
\`\`\`

### 2. Lista de Logins (`logins.json`)
Crie um arquivo chamado `logins.json` na raiz do projeto. Este arquivo deve conter um array (lista) em formato JSON com as credenciais que você deseja validar:

\`\`\`json
[
  { "user": "usuario_01", "password": "senha_01" },
  { "user": "usuario_02", "password": "senha_02" }
]
\`\`\`

> ⚠️ **Atenção:** Certifique-se de que os arquivos `.env` e `logins.json` estão adicionados ao seu arquivo `.gitignore` para evitar vazamentos acidentais de credenciais.

## ▶️ Execução

Para iniciar a validação, basta rodar o script principal no terminal:

\`\`\`bash
node index.js
\`\`\`

O script iterará sobre cada credencial do `logins.json`, tentará conectar ao banco configurado no `.env`  e executará uma varredura nas tabelas de sistema do SQL Server usando a função `HAS_PERMS_BY_NAME`.

## 📊 Resultados e Output

Após a execução, um arquivo chamado **`resultado_acessos.csv`** será gerado automaticamente na raiz do projeto. 

O arquivo possui a seguinte estrutura de colunas:
* **login:** O usuário que foi testado.
* **SchemaName:** O schema do objeto (ex: `dbo`). Retorna "SEM_ACESSO" ou "ERRO_CONEXAO" em caso de falha.
* **ObjectName:** O nome da tabela, view, ou a mensagem descritiva de erro/falta de acesso.
* **ObjectType:** O tipo do objeto (`USER_TABLE`, `VIEW`, `ERRO`, etc).

Este formato tabular facilita a importação direta para Excel, Power BI ou o compartilhamento com equipes de auditoria e segurança.