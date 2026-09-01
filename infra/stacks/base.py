"""Rol OIDC GitHub→AWS: el workflow docker.yml asume este rol para empujar la
imagen validada a ECR. Confianza limitada al repo Ivenaccip/aws-media."""
import aws_cdk as cdk
from aws_cdk import Stack, aws_ecr as ecr, aws_iam as iam
from constructs import Construct

# GitHub emite el sub con IDs inmutables (owner@id/repo@id) — verificado en el
# run 33540172983; se aceptan ambos formatos por robustez.
SUB_PATTERNS = [
    "repo:Ivenaccip/aws-media:*",
    "repo:Ivenaccip@45603061/aws-media@1349232464:*",
]


class BaseStack(Stack):
    def __init__(self, scope: Construct, id_: str, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        provider = iam.OpenIdConnectProvider(
            self, "GitHubOidc",
            url="https://token.actions.githubusercontent.com",
            client_ids=["sts.amazonaws.com"],
        )
        role = iam.Role(
            self, "GitHubEcrPush",
            role_name="aws-media-github-ecr",
            assumed_by=iam.WebIdentityPrincipal(
                provider.open_id_connect_provider_arn,
                conditions={
                    "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
                    "StringLike": {"token.actions.githubusercontent.com:sub": SUB_PATTERNS},
                },
            ),
            max_session_duration=cdk.Duration.hours(1),
        )
        repo = ecr.Repository.from_repository_name(self, "Repo", "aws-media")
        repo.grant_push(role)
        role.add_to_policy(iam.PolicyStatement(
            actions=["ecr:GetAuthorizationToken"], resources=["*"]))

        cdk.CfnOutput(self, "RoleArn", value=role.role_arn)
