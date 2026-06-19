require('dotenv').config();

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const loginsPath = path.join(__dirname, 'logins.json');

if (!fs.existsSync(loginsPath)) {
  console.error('ERRO: O arquivo logins.json não foi encontrado.');
  process.exit(1);
}

const loginsToTest = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));

const dbConfigBase = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    readOnlyIntent: true
  }
};

// Nova Query: Busca a quais Database Roles o usuário atual pertence
const queryRoles = `
    SELECT r.name AS RoleName
    FROM sys.database_role_members rm
    JOIN sys.database_principals r ON rm.role_principal_id = r.principal_id
    WHERE rm.member_principal_id = DATABASE_PRINCIPAL_ID();
`;

// Query Original: Busca os acessos explícitos a objetos
const queryAcessos = `
    SELECT 
        s.name AS SchemaName,
        t.name AS ObjectName,
        t.type_desc AS ObjectType
    FROM sys.objects t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.type IN ('U', 'V')
      AND HAS_PERMS_BY_NAME(s.name + '.' + t.name, 'OBJECT', 'SELECT') = 1
    ORDER BY ObjectType, SchemaName, ObjectName;
`;

async function runValidation() {
  // Cabeçalho do CSV atualizado com a coluna Roles
  let csvContent = 'login,Roles,SchemaName,ObjectName,ObjectType\n';

  for (const creds of loginsToTest) {
    console.log(`Validando acesso para: ${creds.user}...`);

    const config = {
      ...dbConfigBase,
      user: creds.user,
      password: creds.password
    };

    let pool;
    try {
      pool = await sql.connect(config);

      // 1. Extrai as Roles (permissões de nível de banco)
      const resultRoles = await pool.request().query(queryRoles);
      const rolesArray = resultRoles.recordset.map(r => r.RoleName);
      // Se o usuário não tiver role explícita, por padrão no SQL Server ele possui a role "public"
      const rolesString = rolesArray.length > 0 ? rolesArray.join('; ') : 'public';

      // 2. Extrai as permissões de nível de Objeto (Tabelas e Views)
      const resultAcessos = await pool.request().query(queryAcessos);

      if (resultAcessos.recordset.length > 0) {
        for (const row of resultAcessos.recordset) {
          csvContent += `"${creds.user}","${rolesString}","${row.SchemaName}","${row.ObjectName}","${row.ObjectType}"\n`;
        }
      } else {
        // Usuário logou, tem Roles, mas não tem objetos de leitura
        csvContent += `"${creds.user}","${rolesString}","SEM_ACESSO","Nenhum objeto de leitura disponível","N/A"\n`;
      }

    } catch (err) {
      const erroLimpo = err.message.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      csvContent += `"${creds.user}","N/A","ERRO_CONEXAO","${erroLimpo}","ERRO"\n`;
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  }

  const fileName = 'resultado_acessos.csv';
  fs.writeFileSync(fileName, csvContent, 'utf-8');

  console.log(`\nConcluído! Resultados exportados para o arquivo: ${fileName}`);
}

if (!process.env.DB_SERVER || !process.env.DB_PORT || !process.env.DB_NAME) {
  console.error('ERRO: Faltam parâmetros no .env. Verifique se o arquivo foi criado corretamente.');
  process.exit(1);
}

runValidation();