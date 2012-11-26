

def rpc_function(func):
    func.rpc_function = True
    return func


def scheduled_function(func):
    func.scheduled_function = True
    return func
