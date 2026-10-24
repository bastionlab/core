"""__NAME__ on the host: the agent loads this file and answers its routes with the same token as its own"""
from dash_sdk import get

@get("/__ID__/hello", quiet=True)
def hello(q):
    return {"hello": "__NAME__ is running on the host"}
