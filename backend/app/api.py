import os
import uuid
from flask import Flask, request, jsonify, send_from_directory, abort
from lxml import etree # Esta é a biblioteca chave para XML/XSD
from flask_cors import CORS

# --- Configuração Inicial ---

# Cria a aplicação Flask
app = Flask(__name__)
CORS(app)

# Define os caminhos baseados na localização deste arquivo
# __file__ é 'backend/app/api.py'
# os.path.dirname(__file__) é 'backend/app'
# os.path.abspath(os.path.join(..., '..')) sobe um nível
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(BASE_DIR, '..', 'model', 'estufa.xsd')
DATA_PATH = os.path.join(BASE_DIR, '..', 'data')

# Limites para as Regras de Negócio (da T2)
LIMITES_REGRAS = {
    "temperatura": (-10.0, 60.0),
    "umidadeAr": (0.0, 100.0),
    "umidadeSolo": (0.0, 100.0),
    "luminosidade": (0.0, 200000.0)
}

# --- Carregamento do Schema ---

# Carrega o schema XSD uma vez quando a aplicação inicia
try:
    schema_doc = etree.parse(SCHEMA_PATH)
    schema = etree.XMLSchema(schema_doc)
    print(f"Schema XSD '{SCHEMA_PATH}' carregado com sucesso.")
except Exception as e:
    print(f"ERRO CRÍTICO: Não foi possível carregar o schema XSD. {e}")
    schema = None # A aplicação vai falhar, o que é esperado

# --- Funções Auxiliares de Validação ---

def validar_regras_negocio(xml_doc):
    """
    Valida as regras de negócio (faixas de valores) após o XSD passar.
    Levanta um ValueError se uma regra falhar.
    """
    # XPaths para encontrar elementos
    leituras = xml_doc.xpath("//leituras/leitura")
    sensores = {s.get("id"): s.get("tipo") for s in xml_doc.xpath("//sensores/sensor")}

    for i, leitura in enumerate(leituras):
        valor_str = leitura.find("valor").text
        sensor_ref = leitura.get("sensorRef")
        
        try:
            valor = float(valor_str)
            tipo_sensor = sensores.get(sensor_ref)

            if tipo_sensor in LIMITES_REGRAS:
                min_val, max_val = LIMITES_REGRAS[tipo_sensor]
                if not (min_val <= valor <= max_val):
                    raise ValueError(
                        f"Valor '{valor}' para o sensor '{sensor_ref}' (tipo: {tipo_sensor}) "
                        f"está fora da faixa permitida [{min_val}, {max_val}]."
                    )
        except Exception as e:
            # Constrói um XPath para o erro
            xpath_erro = f"/estufa/leituras/leitura[{i+1}]/valor"
            # Retorna um formato de erro T3
            return (False, {
                "code": "BUSINESS_RULE_ERROR",
                "message": str(e),
                "xpath": xpath_erro
            })
            
    return (True, None) # Sucesso


# --- Endpoints da API ---

@app.route("/api/ping", methods=['GET'])
def ping():
    """Endpoint de teste para verificar se a API está no ar."""
    return jsonify({"message": "Pong! A API da Estufa IoT está no ar."}), 200


@app.route("/api/xml", methods=['POST'])
def handle_post_xml():
    """
    Endpoint principal (RF1, RF2, RF3, RF7).
    Recebe um XML, valida contra XSD, valida regras de negócio e persiste.
    """
    if schema is None:
        return jsonify({"code": "SERVER_ERROR", "message": "Schema XSD não está carregado."}), 500

    # 1. Obter o XML bruto da requisição
    xml_data = request.data
    if not xml_data:
        return jsonify({"code": "BAD_REQUEST", "message": "Corpo da requisição vazio."}), 400

    # 2. Tentar parsear o XML (checa se é bem formado)
    try:
        xml_doc = etree.fromstring(xml_data)
    except etree.XMLSyntaxError as e:
        return jsonify({
            "code": "XML_SYNTAX_ERROR", 
            "message": "XML mal formado.",
            "details": str(e)
        }), 400

    # 3. Validação Camada 1: XSD (Estrutura, Tipos, ID/IDREF)
    try:
        schema.assertValid(xml_doc)
    except etree.DocumentInvalid as e:
        # Erro de validação XSD (RF2, RF7)
        return jsonify({
            "code": "XSD_VALIDATION_ERROR",
            "message": "XML falhou na validação XSD.",
            "details": str(e) # A 'lxml' já dá uma ótima mensagem de erro
        }), 400

    # 4. Validação Camada 2: Regras de Negócio (RNF7)
    sucesso_regras, erro_regras = validar_regras_negocio(xml_doc)
    if not sucesso_regras:
        return jsonify(erro_regras), 400 # Erro 400 com JSON (da T3)

    # 5. Persistência (RF3)
    try:
        # Gera um ID único para o arquivo
        file_id = f"leitura_{uuid.uuid4()}.xml"
        file_path = os.path.join(DATA_PATH, file_id)
        
        # Salva o XML *original* no disco
        with open(file_path, 'wb') as f: # 'wb' (write bytes) para manter a codificação original
            f.write(xml_data)
            
    except Exception as e:
        return jsonify({"code": "PERSISTENCE_ERROR", "message": f"Falha ao salvar o arquivo: {e}"}), 500

    # 6. Sucesso (201 Created)
    return jsonify({
        "id": file_id,
        "message": "XML válido e armazenado com sucesso."
    }), 201


@app.route("/api/xml/<string:id>", methods=['GET'])
def get_xml_by_id(id):
    """
    Endpoint para recuperar um XML específico pelo seu ID (nome do arquivo).
    """
    try:
        # Validação de segurança básica (evitar "directory traversal")
        if ".." in id or "/" in id or "\\" in id:
            abort(400, "ID de arquivo inválido.")
            
        # Tenta enviar o arquivo
        # 'send_from_directory' é a forma segura de fazer isso
        return send_from_directory(
            DATA_PATH, 
            id, 
            mimetype='application/xml',
            as_attachment=False # Mostra no navegador em vez de baixar
        )
    except FileNotFoundError:
        abort(404, "Arquivo XML não encontrado.")
    except Exception as e:
        return jsonify({"code": "SERVER_ERROR", "message": str(e)}), 500


@app.route("/api/consulta", methods=['GET'])
def handle_consulta():
    """
    Endpoint de consulta (RF5, RF6).
    Lê todos os XMLs, filtra e retorna um JSON agregado.
    (Esta é uma implementação básica para fins de T3)
    """
    # Obtém filtros da URL (ex: ?sensorId=tNorte)
    sensor_id_filtro = request.args.get('sensorId')
    
    resultados = []
    
    try:
        # Itera sobre todos os arquivos na pasta 'data'
        for filename in os.listdir(DATA_PATH):
            if not filename.endswith('.xml'):
                continue
                
            file_path = os.path.join(DATA_PATH, filename)
            
            # Parseia o XML
            xml_doc = etree.parse(file_path)
            
            # Pega o mapa de sensores (id -> (tipo, loc))
            sensores_map = {
                s.get("id"): (s.get("tipo"), s.get("unidade"), s.findtext("localizacao", ""))
                for s in xml_doc.xpath("//sensores/sensor")
            }

            # Monta o XPath de filtro
            xpath_query = "//leituras/leitura"
            if sensor_id_filtro:
                xpath_query += f"[@sensorRef='{sensor_id_filtro}']"
                
            leituras = xml_doc.xpath(xpath_query)
            
            for leitura in leituras:
                sensor_ref = leitura.get("sensorRef")
                sensor_info = sensores_map.get(sensor_ref, ("desconhecido", "N/A", ""))
                
                resultados.append({
                    "sensorId": sensor_ref,
                    "tipo": sensor_info[0],
                    "unidade": sensor_info[1],
                    "localizacao": sensor_info[2],
                    "dataHora": leitura.findtext("dataHora"),
                    "valor": float(leitura.findtext("valor")),
                    "arquivoOrigem": filename
                })
                
    except Exception as e:
        return jsonify({"code": "QUERY_ERROR", "message": str(e)}), 500
        
    # (Poderia adicionar filtros de dataInicio/dataFim aqui)
    
    return jsonify({
        "totalResultados": len(resultados),
        "filtrosAplicados": {"sensorId": sensor_id_filtro},
        "leituras": resultados
    })


# --- Execução da Aplicação ---

if __name__ == '__main__':
    # Garante que a pasta de dados exista
    if not os.path.exists(DATA_PATH):
        os.makedirs(DATA_PATH)
        
    # Roda o servidor Flask
    # debug=True reinicia o servidor automaticamente quando você salva o arquivo
    app.run(debug=True, port=5000)
