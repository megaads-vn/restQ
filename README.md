# RestQ
Cool message queue server uses HTTP Gateway
## Usage:
1. You need to contact our contributors to configure consumers in restQ, so that restQ can deliver your request to the producer you want
2. Instead of sending a request directly to an endpoint, you can send it to restQ, restQ will queue it and will send the request to the endpoint.

  - Example:
    - You send request to endpoint: ```api-domain.com/api/send-request```
    - You send request to restQ: ```restQ-domain.com/api/send-request```
## Request data options:
**1. is_callback, postback_url**
  - ```is_callback = 0```: not wait for returning
  - ```is_callback = 1 (default)```:
    - ```postback_url is empty (default)```: wait for the result to return itself
    - ```postback_url is not empty```: wait for the result to return it to postback_url
    
**2. priority**: Priority of request

