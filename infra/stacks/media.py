"""C3 — media: bucket S3 privado (subidas prefirmadas directo del navegador) +
CloudFront con Origin Access Control para servirlo. El layout de claves espeja
MEDIA_ROOT (videos/<proyecto>/...), así los ejecutores de C4 sincronizan por
prefijo. Sin coste fijo: S3 por GB (centavos) y CloudFront con free tier.

El bucket es RETAIN: el media de los usuarios es dinero gastado (regla dura:
las versiones no se borran)."""
import aws_cdk as cdk
from aws_cdk import (
    Stack,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3 as s3,
)
from constructs import Construct


class MediaStack(Stack):
    def __init__(self, scope: Construct, id_: str, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        self.bucket = s3.Bucket(
            self, "Media",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            # el PUT prefirmado llega directo del navegador: CORS obligatorio.
            # Origen * mientras el login no se exige (deuda C1); se restringe
            # al dominio de la app cuando haya auth.
            cors=[s3.CorsRule(
                allowed_methods=[s3.HttpMethods.PUT, s3.HttpMethods.GET,
                                 s3.HttpMethods.HEAD],
                allowed_origins=["*"], allowed_headers=["*"], max_age=3600)],
            removal_policy=cdk.RemovalPolicy.RETAIN,
        )
        self.cdn = cloudfront.Distribution(
            self, "Cdn",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(self.bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
            ),
        )

        cdk.CfnOutput(self, "BucketName", value=self.bucket.bucket_name)
        cdk.CfnOutput(self, "CdnDomain", value=self.cdn.distribution_domain_name)
