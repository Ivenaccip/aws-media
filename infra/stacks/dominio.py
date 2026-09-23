"""El nombre propio del API: irremplazables.xyz. Stack AISLADO a propósito.

Por qué no vive en `stacks/api.py`, que es donde uno lo buscaría: `infra/app.py`
llama a `_digest_de(IMAGE_TAG)` en CADA synth y re-fija con él el `ImageUri` de
la Lambda del API, de la del worker y de la task de Fargate. Así que tocar
`aws-media-api` para ponerle un nombre bonito significaría estrenar en
producción la imagen que tenga `:latest` en ese momento — verificado el
2026-09-22: la Lambda corre `sha256:80a0550e…` y `:latest` es `sha256:4632a488…`,
que no ha corrido nunca. Y `cdk deploy aws-media-api` arrastra TRES stacks de
dependencia, no dos: db, media y jobs (app.py le pasa a ApiStack el `jobs_queue`
y el `producir_sm`, que salen de JobsStack, y JobsStack también recibe el
digest). Poner un CNAME no puede costar eso.

Aquí el template entero son DOS recursos. No puede reemplazar el API, no puede
tocar la base, y si el deploy falla, el rollback no arrastra nada más.

El API se nombra por su id FÍSICO en vez de importarlo del otro stack, por la
misma razón que en `stacks/alertas.py`: un import crea dependencia de despliegue
entre stacks, que es exactamente lo que este archivo existe para evitar.
Contrapartida conocida y aceptada, idéntica a la de las dimensiones de las
alarmas: si algún día el API se recreara, esto se queda apuntando al viejo.

El certificado se pide FUERA de CDK y entra por ARN ya emitido. Si se declarara
aquí con validación DNS, CloudFormation se quedaría en CREATE_IN_PROGRESS
esperando unos CNAME que hay que pegar a mano —la zona está en Cloudflare, no
en Route 53, así que CDK no los puede escribir solo—. La documentación de
CloudFormation lo dice textual: el stack se queda ahí hasta que alguien valide.
Con un ARN ya ISSUED, este deploy tarda un minuto o falla en un minuto.

Deploy (desde infra/), SOLO con el certificado en ISSUED:

    set "CERT_ARN=arn:aws:acm:us-east-1:191241816158:certificate/XXXX"
    npx cdk --app "python app_dominio.py" deploy aws-media-dominio
    set "CERT_ARN="

Después queda UN paso manual sin el cual nada de esto se ve: apuntar el CNAME de
Cloudflare al valor del output `CloudflareApunteAqui`. Ese valor NO es
"irremplazables.xyz" y NO es el endpoint execute-api (ver el comentario del
output). El runbook está en docs/OPERACION.md.
"""
import aws_cdk as cdk
from aws_cdk import (Stack,
                     aws_apigatewayv2 as apigwv2,
                     aws_certificatemanager as acm)
from constructs import Construct

# Ids físicos verificados contra la cuenta el 2026-09-22. Literales a propósito:
# este template no importa nada de aws-media-api.
API_ID = "2ecset5i94"
STAGE = "$default"          # el stage con autoDeploy=True que ya existe
DOMINIO = "irremplazables.xyz"


class DominioStack(Stack):
    """El nombre público del API, y nada más que eso."""

    def __init__(self, scope: Construct, id_: str, *, certificado_arn: str,
                 **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        cert = acm.Certificate.from_certificate_arn(self, "Cert", certificado_arn)

        dominio = apigwv2.DomainName(
            self, "Dominio",
            domain_name=DOMINIO,
            certificate=cert,
            # REGIONAL es el único tipo que EXISTE para HTTP API v2. Va
            # explícito y no por omisión porque el enum de CDK ofrece EDGE y no
            # lo valida en synth: copiar un ejemplo de REST v1 pasa el synth
            # limpio y revienta en el deploy, con CloudFormation ya en marcha.
            endpoint_type=apigwv2.EndpointType.REGIONAL,
            # TLS 1.2 es el mínimo soportado para dominios de HTTP API. Ojo:
            # pasarlo SÍ cambia el template — omitido, la propiedad no sale en
            # el YAML. En un dominio nuevo da igual; agregarlo encima de uno ya
            # creado sin él es un cambio real.
            security_policy=apigwv2.SecurityPolicy.TLS_1_2,
            # ip_address_type se queda en su default: Cloudflare se pone delante
            # y resuelve. Dualstack no cambiaría lo que ve el navegador y añade
            # una superficie más que probar.
        )

        # Mapeo L1 y no el constructo `ApiMapping`: el L2 exige un objeto IStage,
        # y el stage vive en el otro stack. Importarlo solo para que el L2 le
        # cuelgue una dependencia que no hace nada rompería el aislamiento que
        # justifica este archivo entero.
        #
        # SIN api_mapping_key a propósito: server/app.py:1075 monta los estáticos
        # en "/" y static/auth.js:37 arma el redirect_uri con
        # location.origin + "/callback.html", que es esquema+host y nada más. Con
        # un mapeo en /algo, esa ruta no cae en ningún mapeo y da 404 de API
        # Gateway antes de llegar a la app. Tampoco vale la cadena vacía.
        #
        # `dominio.name` es un Ref, así que CloudFormation deduce el orden solo:
        # primero el dominio, después el mapeo.
        apigwv2.CfnApiMapping(
            self, "Mapeo",
            api_id=API_ID,
            domain_name=dominio.name,
            stage=STAGE,
        )

        # Este es el valor que nadie adivina, y el que rompe el despliegue cuando
        # se adivina. NO es "irremplazables.xyz" y NO es
        # "2ecset5i94.execute-api...". Es un TERCER hostname
        # (d-xxxxxxxxxx.execute-api.us-east-1.amazonaws.com) que API Gateway
        # genera para ESTE dominio personalizado. Apuntar el CNAME al execute-api
        # resuelve perfecto y el TLS ni siquiera llega a validar: ese endpoint
        # presenta el certificado de *.execute-api.us-east-1.amazonaws.com, que
        # no cubre nuestro nombre.
        cdk.CfnOutput(self, "CloudflareApunteAqui",
                      value=dominio.regional_domain_name,
                      description="El CNAME de Cloudflare apunta a este valor, tal cual")
        # Los dos juntos, para poder copiarlos de un vistazo sin confundirlos.
        cdk.CfnOutput(self, "DominioNombre", value=dominio.name)
