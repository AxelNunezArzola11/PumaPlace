# test_dominio.py

def es_edad_valida_para_registro(edad: int) -> bool:
    """Regla de dominio: solo usuarios mayores o iguales a 18 años."""
    return edad >= 18

def test_edad_valida_mayor_de_edad():
    assert es_edad_valida_para_registro(20) is True

def test_edad_invalida_menor_de_edad():
    assert es_edad_valida_para_registro(15) is False
