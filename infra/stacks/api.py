"""C1 — API viva: la app completa (f1/e1/APIs) servida por Lambda contenedor
detrás de API Gateway HTTP. Cognito queda CREADO (pool + client + dominio
hosted UI) pero sin exigirse aún: el frontend no tiene pantalla de login —
ese cableado es una rebanada posterior y está registrado en el plan."""
import aws_cdk as cdk
from aws_cdk import (
    Duration, Stack,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigw_int,
    aws_cognito as cognito,
    aws_ecr as ecr,
    aws_lambda as lambda_,
)
from constructs import Construct


class ApiStack(Stack):
    def __init__(self, scope: Construct, id_: str, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        repo = ecr.Repository.from_repository_name(self, "Repo", "aws-media")
        fn = lambda_.DockerImageFunction(
            self, "Api",
            code=lambda_.DockerImageCode.from_ecr(
                repo, tag_or_digest="latest",
                entrypoint=["/usr/local/bin/python", "-m", "awslambdaric"],
                cmd=["server.lambda_handler.handler"],
            ),
            memory_size=1536,
            timeout=Duration.seconds(29),   # API Gateway corta a los 30 s
            environment={
                "MEDIA_ROOT": "/data",       # horneado vacío en la imagen (C3 lo lleva a S3)
                "PYTHONIOENCODING": "utf-8",
                "HOME": "/tmp",              # único directorio escribible en Lambda
            },
            # regla dura del plan: single-worker hasta que el estado viva en
            # Postgres (C2) y los trabajos en colas (C4)
            reserved_concurrent_executions=1,
        )

        http_api = apigwv2.HttpApi(
            self, "HttpApi", api_name="aws-media",
            default_integration=apigw_int.HttpLambdaIntegration("Fn", fn),
        )

        pool = cognito.UserPool(
            self, "Users", user_pool_name="aws-media-users",
            self_sign_up_enabled=False,      # alta manual mientras es piloto
            sign_in_aliases=cognito.SignInAliases(email=True),
            removal_policy=cdk.RemovalPolicy.RETAIN,
        )
        client = pool.add_client(
            "web",
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                # placeholder: se apunta a la URL real cuando el frontend tenga login
                callback_urls=["https://localhost/callback"],
            ),
        )
        pool.add_domain("Domain", cognito_domain=cognito.CognitoDomainOptions(
            domain_prefix="aws-media-ivenaccip"))

        cdk.CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        cdk.CfnOutput(self, "UserPoolId", value=pool.user_pool_id)
        cdk.CfnOutput(self, "UserPoolClientId", value=client.user_pool_client_id)
